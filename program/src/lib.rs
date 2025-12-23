#![deny(clippy::all)]

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    ed25519_program,
    entrypoint::ProgramResult,
    instruction::Instruction,
    msg,
    program::{invoke_signed},
    program_error::ProgramError,
    pubkey::Pubkey,
    system_instruction,
    sysvar::{instructions as ix_sysvar, rent::Rent, Sysvar},
};

solana_program::declare_id!("SNOWy1111111111111111111111111111111111");

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub enum SnowyInstruction {
    /// Records an inference authorization on-chain.
    ///
    /// Security model: the transaction must include an Ed25519SigVerify instruction
    /// that verifies `signer` signed the 32-byte `request_hash` message.
    ///
    /// Accounts:
    /// 0. [signer] Signer (wallet)
    /// 1. [writable] Record PDA account (created by this instruction)
    /// 2. [] System program
    /// 3. [] Instructions sysvar
    Record { request_hash: [u8; 32], timestamp: i64 },
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct InferenceRecord {
    pub signer: Pubkey,
    pub request_hash: [u8; 32],
    pub timestamp: i64,
    pub bump: u8,
}

#[derive(thiserror::Error, Debug, Clone)]
pub enum SnowyError {
    #[error("Invalid instruction data")]
    InvalidInstructionData,
    #[error("Missing required ed25519 verification instruction")]
    MissingEd25519Verification,
    #[error("Record PDA mismatch")]
    RecordPdaMismatch,
    #[error("Record already initialized")]
    AlreadyInitialized,
}

impl From<SnowyError> for ProgramError {
    fn from(_: SnowyError) -> Self {
        ProgramError::InvalidArgument
    }
}

pub fn process_instruction(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let ix = SnowyInstruction::try_from_slice(data).map_err(|_| SnowyError::InvalidInstructionData)?;

    match ix {
        SnowyInstruction::Record {
            request_hash,
            timestamp,
        } => record(program_id, accounts, request_hash, timestamp),
    }
}

fn record(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    request_hash: [u8; 32],
    timestamp: i64,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let signer = next_account_info(account_info_iter)?;
    let record_pda = next_account_info(account_info_iter)?;
    let system_program = next_account_info(account_info_iter)?;
    let instructions_sysvar = next_account_info(account_info_iter)?;

    if !signer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if *system_program.key != solana_program::system_program::id() {
        return Err(ProgramError::IncorrectProgramId);
    }
    if *instructions_sysvar.key != ix_sysvar::id() {
        return Err(ProgramError::InvalidArgument);
    }

    // Require an ed25519 verification instruction somewhere in the same transaction.
    if !tx_contains_ed25519_verification(instructions_sysvar, signer.key, &request_hash)? {
        msg!("Missing ed25519 verification for signer+request_hash");
        return Err(SnowyError::MissingEd25519Verification.into());
    }

    // Derive the record PDA.
    let (expected_pda, bump) = Pubkey::find_program_address(
        &[b"snowy", signer.key.as_ref(), &request_hash],
        program_id,
    );
    if expected_pda != *record_pda.key {
        msg!("Expected PDA: {}", expected_pda);
        msg!("Provided PDA: {}", record_pda.key);
        return Err(SnowyError::RecordPdaMismatch.into());
    }

    // Prevent re-initialization.
    if record_pda.owner == program_id && !record_pda.data_is_empty() {
        return Err(SnowyError::AlreadyInitialized.into());
    }

    let record = InferenceRecord {
        signer: *signer.key,
        request_hash,
        timestamp,
        bump,
    };

    let rent = Rent::get()?;
    let space = record.try_to_vec().map_err(|_| ProgramError::InvalidAccountData)?.len();
    let lamports = rent.minimum_balance(space);

    // Create PDA account owned by this program.
    invoke_signed(
        &system_instruction::create_account(
            signer.key,
            record_pda.key,
            lamports,
            space as u64,
            program_id,
        ),
        &[signer.clone(), record_pda.clone(), system_program.clone()],
        &[&[b"snowy", signer.key.as_ref(), &request_hash, &[bump]]],
    )?;

    record
        .serialize(&mut &mut record_pda.data.borrow_mut()[..])
        .map_err(|_| ProgramError::InvalidAccountData)?;

    msg!("SNOWY record stored. signer={}, ts={} request_hash={:?}", signer.key, timestamp, request_hash);
    Ok(())
}

fn tx_contains_ed25519_verification(
    instructions_sysvar: &AccountInfo,
    signer_pubkey: &Pubkey,
    message32: &[u8; 32],
) -> Result<bool, ProgramError> {
    let mut idx: u16 = 0;
    loop {
        let ix: Instruction = match ix_sysvar::load_instruction_at_checked(idx as usize, instructions_sysvar) {
            Ok(ix) => ix,
            Err(_) => break,
        };

        if ix.program_id == ed25519_program::id() {
            if ed25519_ix_matches(&ix.data, signer_pubkey, message32)? {
                return Ok(true);
            }
        }

        idx = idx.checked_add(1).ok_or(ProgramError::InvalidArgument)?;
    }

    Ok(false)
}

// Ed25519 instruction layout (Solana built-in ed25519 program):
// - u8: num_signatures
// - u8: padding
// - num_signatures * 14 bytes: offset structs (little-endian)
// - followed by signature/pubkey/message data referenced by offsets
fn ed25519_ix_matches(data: &[u8], signer_pubkey: &Pubkey, message32: &[u8; 32]) -> Result<bool, ProgramError> {
    if data.len() < 2 {
        return Ok(false);
    }
    let num = data[0] as usize;
    let header_len = 2;
    let offsets_len = num
        .checked_mul(14)
        .ok_or(ProgramError::InvalidArgument)?;
    let base = header_len.checked_add(offsets_len).ok_or(ProgramError::InvalidArgument)?;
    if data.len() < base {
        return Ok(false);
    }

    for i in 0..num {
        let off = header_len + i * 14;
        let sig_off = read_u16_le(data, off)? as usize;
        let _sig_ix = read_u16_le(data, off + 2)?;
        let pk_off = read_u16_le(data, off + 4)? as usize;
        let _pk_ix = read_u16_le(data, off + 6)?;
        let msg_off = read_u16_le(data, off + 8)? as usize;
        let msg_sz = read_u16_le(data, off + 10)? as usize;
        let _msg_ix = read_u16_le(data, off + 12)?;

        // Signature must be 64 bytes, pubkey 32 bytes, message 32 bytes.
        if sig_off.checked_add(64).map_or(true, |end| end > data.len()) {
            continue;
        }
        if pk_off.checked_add(32).map_or(true, |end| end > data.len()) {
            continue;
        }
        if msg_sz != 32 {
            continue;
        }
        if msg_off.checked_add(msg_sz).map_or(true, |end| end > data.len()) {
            continue;
        }

        let pk_bytes = &data[pk_off..pk_off + 32];
        if pk_bytes != signer_pubkey.as_ref() {
            continue;
        }

        let msg_bytes = &data[msg_off..msg_off + 32];
        if msg_bytes != message32 {
            continue;
        }

        return Ok(true);
    }

    Ok(false)
}

fn read_u16_le(data: &[u8], offset: usize) -> Result<u16, ProgramError> {
    if offset + 2 > data.len() {
        return Err(ProgramError::InvalidArgument);
    }
    Ok(u16::from_le_bytes([data[offset], data[offset + 1]]))
}

// Standard Solana entrypoint
#[cfg(not(feature = "no-entrypoint"))]
solana_program::entrypoint!(entrypoint);

#[cfg(not(feature = "no-entrypoint"))]
fn entrypoint(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    process_instruction(program_id, accounts, data)
}
