use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("7jX1wARzGUpdxPoziofJPy6Kz5fQ3ksoTFzrDquKk7xn");

#[program]
pub mod greed_staking {
    use super::*;

    /// Initialize the staking pool with vault
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let pool = &mut ctx.accounts.stake_pool;
        pool.authority = ctx.accounts.authority.key();
        pool.token_mint = ctx.accounts.token_mint.key();
        pool.vault = ctx.accounts.vault.key();
        pool.total_staked = 0;
        pool.bump = ctx.bumps.stake_pool;
        pool.vault_bump = ctx.bumps.vault;

        msg!("Stake pool initialized");
        Ok(())
    }

    /// Stake tokens into the vault
    pub fn stake(ctx: Context<StakeTokens>, amount: u64) -> Result<()> {
        require!(amount > 0, StakingError::ZeroAmount);

        // Transfer tokens from user to vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        // Update user stake
        let user_stake = &mut ctx.accounts.user_stake;
        let clock = Clock::get()?;

        if user_stake.amount == 0 {
            // New stake
            user_stake.owner = ctx.accounts.user.key();
            user_stake.staked_at = clock.unix_timestamp;
        } else {
            // Adding to existing stake - reset warmup
            user_stake.staked_at = clock.unix_timestamp;
        }
        user_stake.amount = user_stake.amount.checked_add(amount).ok_or(StakingError::Overflow)?;
        user_stake.bump = ctx.bumps.user_stake;

        // Update pool total
        let pool = &mut ctx.accounts.stake_pool;
        pool.total_staked = pool.total_staked.checked_add(amount).ok_or(StakingError::Overflow)?;

        msg!("Staked {} tokens", amount);
        Ok(())
    }

    /// Unstake all tokens from the vault
    pub fn unstake(ctx: Context<Unstake>) -> Result<()> {
        let amount = ctx.accounts.user_stake.amount;

        require!(amount > 0, StakingError::NoStake);

        // Transfer tokens from vault back to user
        let token_mint = ctx.accounts.stake_pool.token_mint;
        let vault_bump = ctx.accounts.stake_pool.vault_bump;
        let seeds = &[
            b"vault",
            token_mint.as_ref(),
            &[vault_bump],
        ];
        let signer = &[&seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.vault.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, amount)?;

        // Update pool total
        ctx.accounts.stake_pool.total_staked = ctx.accounts.stake_pool.total_staked.checked_sub(amount).ok_or(StakingError::Underflow)?;

        // Reset user stake
        ctx.accounts.user_stake.amount = 0;
        ctx.accounts.user_stake.staked_at = 0;

        msg!("Unstaked {} tokens", amount);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = authority,
        space = 8 + StakePool::INIT_SPACE,
        seeds = [b"stake_pool", token_mint.key().as_ref()],
        bump
    )]
    pub stake_pool: Account<'info, StakePool>,

    #[account(
        init,
        payer = authority,
        token::mint = token_mint,
        token::authority = vault,
        seeds = [b"vault", token_mint.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct StakeTokens<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"stake_pool", stake_pool.token_mint.as_ref()],
        bump = stake_pool.bump
    )]
    pub stake_pool: Account<'info, StakePool>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserStake::INIT_SPACE,
        seeds = [b"user_stake", stake_pool.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub user_stake: Account<'info, UserStake>,

    #[account(
        mut,
        seeds = [b"vault", stake_pool.token_mint.as_ref()],
        bump = stake_pool.vault_bump
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = user_token_account.owner == user.key(),
        constraint = user_token_account.mint == stake_pool.token_mint
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Unstake<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"stake_pool", stake_pool.token_mint.as_ref()],
        bump = stake_pool.bump
    )]
    pub stake_pool: Account<'info, StakePool>,

    #[account(
        mut,
        seeds = [b"user_stake", stake_pool.key().as_ref(), user.key().as_ref()],
        bump = user_stake.bump,
        constraint = user_stake.owner == user.key()
    )]
    pub user_stake: Account<'info, UserStake>,

    #[account(
        mut,
        seeds = [b"vault", stake_pool.token_mint.as_ref()],
        bump = stake_pool.vault_bump
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = user_token_account.owner == user.key(),
        constraint = user_token_account.mint == stake_pool.token_mint
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[account]
#[derive(InitSpace)]
pub struct StakePool {
    pub authority: Pubkey,
    pub token_mint: Pubkey,
    pub vault: Pubkey,
    pub total_staked: u64,
    pub bump: u8,
    pub vault_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct UserStake {
    pub owner: Pubkey,
    pub amount: u64,
    pub staked_at: i64,
    pub bump: u8,
}

#[error_code]
pub enum StakingError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("No active stake found")]
    NoStake,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Arithmetic underflow")]
    Underflow,
}
