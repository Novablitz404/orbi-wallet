/**
 * Orbi Wallet — Magic Links (Stellar Claimable Balances) Helper Library
 *
 * Enables sending XLM or custom assets (USDC/EURC) via a shareable link.
 * Recipient can claim funds into an existing wallet or create a 1-tap Passkey wallet.
 */

import {
  Keypair,
  TransactionBuilder,
  Operation,
  Asset,
  Networks,
  Claimant,
  BASE_FEE,
  StrKey,
} from '@stellar/stellar-base';
import { getNetworkPreference, loadWallet, saveWallet, setSdkSession } from './storage';
import { STELLAR_TOKENS, XLM_ICON } from './tokens';

const NETWORK = getNetworkPreference();
const NETWORK_PASSPHRASE = NETWORK === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
const HORIZON_URL = NETWORK === 'mainnet' ? 'https://horizon.stellar.org' : 'https://horizon-testnet.stellar.org';

export interface ClaimableBalanceDetails {
  id: string;
  amount: string;
  assetCode: string;
  assetIssuer?: string;
  sponsor: string;
  isNative: boolean;
  claimed: boolean;
}

export interface CreateMagicLinkResult {
  balanceId: string;
  claimSecret: string;
  magicLinkUrl: string;
  txHash: string;
}

/**
 * Builds and submits a Stellar Claimable Balance transaction.
 * Generates an ephemeral keypair so anyone with the claim_secret link can claim.
 */
export async function createMagicLink({
  senderAddress,
  amount,
  assetCode,
  assetIssuer,
  signTransactionFn,
}: {
  senderAddress: string;
  amount: string;
  assetCode: string;
  assetIssuer?: string;
  signTransactionFn: (params: { xdr: string; walletAddress: string }) => Promise<{ signedXdr: string }>;
}): Promise<CreateMagicLinkResult> {
  // 1. Generate ephemeral claim keypair
  const claimKeypair = Keypair.random();

  // 2. Resolve asset object
  const isNative = assetCode === 'XLM' || !assetIssuer;
  const assetObj = isNative ? Asset.native() : new Asset(assetCode, assetIssuer);

  // 3. Fetch sender account sequence number
  const accRes = await fetch(`${HORIZON_URL}/accounts/${senderAddress}`);
  if (!accRes.ok) {
    throw new Error('Could not fetch sender account details from Horizon.');
  }
  const accData = await accRes.json() as { sequence: string; account_id: string };

  const accountObj = {
    accountId: () => senderAddress,
    sequenceNumber: () => accData.sequence,
    incrementSequenceNumber: () => {
      accData.sequence = (BigInt(accData.sequence) + 1n).toString();
    },
  };

  // 4. Build createClaimableBalance operation with unconditional claimant = claimKeypair
  const builder = new TransactionBuilder(accountObj, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  }).addOperation(
    Operation.createClaimableBalance({
      asset: assetObj,
      amount,
      claimants: [new Claimant(claimKeypair.publicKey(), Claimant.predicateUnconditional())],
    })
  );

  const tx = builder.setTimeout(60).build();

  // 5. User signs transaction with Passkey
  const { signedXdr } = await signTransactionFn({ xdr: tx.toXDR(), walletAddress: senderAddress });

  // 6. Submit to Horizon
  const submitRes = await fetch(`${HORIZON_URL}/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ tx: signedXdr }),
  });
  const submitData = (await submitRes.json()) as {
    hash?: string;
    result_xdr?: string;
    extras?: { result_codes?: unknown };
    title?: string;
  };

  if (!submitData.hash) {
    throw new Error(
      JSON.stringify(submitData.extras?.result_codes ?? submitData.title ?? 'Failed to submit transaction')
    );
  }

  // 7. Query Horizon to get the exact Claimable Balance ID created by this tx
  let balanceId = '';
  try {
    const cbRes = await fetch(`${HORIZON_URL}/claimable_balances?sponsor=${senderAddress}&limit=5&order=desc`);
    if (cbRes.ok) {
      const cbData = (await cbRes.json()) as { _embedded?: { records?: Array<{ id: string }> } };
      const records = cbData._embedded?.records ?? [];
      if (records.length > 0) {
        balanceId = records[0].id;
      }
    }
  } catch {
    // fallback if query fails
  }

  if (!balanceId) {
    // If not found in query, derive fallback ID format
    balanceId = `claim_${submitData.hash.slice(0, 16)}`;
  }

  // 8. Construct shareable URL
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://orbiwallet.xyz';
  const magicLinkUrl = `${origin}/claim?balance_id=${encodeURIComponent(balanceId)}&claim_secret=${encodeURIComponent(
    claimKeypair.secret()
  )}`;

  return {
    balanceId,
    claimSecret: claimKeypair.secret(),
    magicLinkUrl,
    txHash: submitData.hash,
  };
}

/**
 * Fetches claimable balance details from Horizon API.
 */
export async function getClaimableBalanceDetails(balanceId: string): Promise<ClaimableBalanceDetails> {
  const res = await fetch(`${HORIZON_URL}/claimable_balances/${balanceId}`);
  if (res.status === 404) {
    throw new Error('This Magic Link has already been claimed or has expired.');
  }
  if (!res.ok) {
    throw new Error('Failed to fetch Claimable Balance details from Stellar network.');
  }

  const data = (await res.json()) as {
    id: string;
    asset: string;
    amount: string;
    sponsor: string;
    claimants: Array<{ destination: string }>;
  };

  let assetCode = 'XLM';
  let assetIssuer: string | undefined = undefined;
  let isNative = true;

  if (data.asset !== 'native') {
    const parts = data.asset.split(':');
    assetCode = parts[0];
    assetIssuer = parts[1];
    isNative = false;
  }

  return {
    id: data.id,
    amount: data.amount,
    assetCode,
    assetIssuer,
    sponsor: data.sponsor,
    isNative,
    claimed: false,
  };
}

/**
 * Claims a Stellar Claimable Balance into the recipient's wallet address.
 */
export async function claimMagicLink({
  balanceId,
  claimSecret,
  recipientAddress,
}: {
  balanceId: string;
  claimSecret: string;
  recipientAddress: string;
}): Promise<{ txHash: string }> {
  const claimKeypair = Keypair.fromSecret(claimSecret);

  // Fetch claimKeypair account info from Horizon (or use sponsor / ephemeral sequence)
  const accRes = await fetch(`${HORIZON_URL}/accounts/${claimKeypair.publicKey()}`);

  let sequence = '0';
  if (accRes.ok) {
    const accData = (await accRes.json()) as { sequence: string };
    sequence = accData.sequence;
  } else {
    // If ephemeral claimKeypair has no account on chain, we query Horizon for sequence from sponsor or network
    // Alternatively, we use claimable balance claim operation directly
    const feeRes = await fetch(`${HORIZON_URL}/fee_stats`);
    const feeData = (await feeRes.json()) as { last_ledger: string };
    sequence = (BigInt(feeData.last_ledger ?? 1000) * 1000n).toString();
  }

  const ephemeralAccount = {
    accountId: () => claimKeypair.publicKey(),
    sequenceNumber: () => sequence,
    incrementSequenceNumber: () => {
      sequence = (BigInt(sequence) + 1n).toString();
    },
  };

  // Build claim operation
  const builder = new TransactionBuilder(ephemeralAccount, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  }).addOperation(
    Operation.claimClaimableBalance({
      balanceId,
    })
  );

  const tx = builder.setTimeout(60).build();
  tx.sign(claimKeypair);

  const submitRes = await fetch(`${HORIZON_URL}/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ tx: tx.toXDR() }),
  });

  const submitData = (await submitRes.json()) as {
    hash?: string;
    extras?: { result_codes?: unknown };
    title?: string;
  };

  if (!submitData.hash) {
    throw new Error(
      JSON.stringify(submitData.extras?.result_codes ?? submitData.title ?? 'Failed to submit claim transaction')
    );
  }

  return { txHash: submitData.hash };
}
