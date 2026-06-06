import { xdr, hash, StrKey, Address, Networks } from '@stellar/stellar-sdk';

export type OrbiNetwork = 'testnet' | 'mainnet';

const PASSPHRASES: Record<OrbiNetwork, string> = {
  testnet: Networks.TESTNET,
  mainnet: Networks.PUBLIC,
};

/**
 * Derive the deterministic wallet C-address for a passkey ID.
 *
 * Matches the relay's deriveWalletAddress — same formula:
 *   salt    = sha256(passkey_id)
 *   address = sha256(networkId + deployer_G_address + salt)
 *
 * Call this immediately after passkey creation to show the user their
 * address — no transaction or network call needed.
 */
export function deriveWalletAddress(params: {
  passkeyId: Uint8Array;
  deployerPublicKey: string;
  network?: OrbiNetwork;
}): string {
  const { passkeyId, deployerPublicKey, network = 'testnet' } = params;
  const networkPassphrase = PASSPHRASES[network];

  const salt = hash(Buffer.from(passkeyId));
  const networkId = hash(Buffer.from(networkPassphrase));

  const preimage = xdr.HashIdPreimage.envelopeTypeContractId(
    new xdr.HashIdPreimageContractId({
      networkId: Buffer.from(networkId),
      contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
        new xdr.ContractIdPreimageFromAddress({
          address: new Address(deployerPublicKey).toScAddress(),
          salt: Buffer.from(salt),
        }),
      ),
    }),
  );

  const contractId = hash(preimage.toXDR());
  return StrKey.encodeContract(contractId);
}
