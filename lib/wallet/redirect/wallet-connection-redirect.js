"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConnectedWalletAccountRedirect = exports.WalletConnectionRedirect = void 0;
const wallet_connection_with_key_management_1 = require("../wallet-connection-with-key-management");
const utils_1 = require("../../utils");
const borsh_1 = require("borsh");
const transaction_1 = require("../../transaction");
const LOGIN_WALLET_URL_SUFFIX = '/login/';
const PENDING_ACCESS_KEY_PREFIX = 'pending_key'; // browser storage key for a pending access key (i.e. key has been generated but we are not sure it was added yet)
/**
 * This class is used in conjunction with the {@link BrowserLocalStorageKeyStore}.
 * It redirects users to {@link https://docs.near.org/docs/tools/near-wallet | NEAR Wallet} for key management.
 *
 * @example {@link https://docs.near.org/docs/develop/front-end/naj-quick-reference#wallet}
 * @example
 * ```js
 * // Create new WalletConnectionRedirect instance.
 * // Typically, you will want to used one of this servers:
 * // mainnetWalletUrl: 'https://wallet.near.org',
 * // testnetWalletUrl: 'https://wallet.testnet.near.org',
 * // betanetWalletUrl: 'https://wallet.betanet.near.org',
 * // localhostWalletUrl: 'http://localhost:4000/wallet',
 * const walletConnection = new WalletConnectionRedirect(near, 'my-app', 'https://wallet.testnet.near.org');
 * // If not signed in redirect to the NEAR wallet to sign in
 * // keys will be stored in the BrowserLocalStorageKeyStore
 * if(!walletConnection.isSingnedIn()) return walletConnection.requestSignIn()
 * ```
 */
class WalletConnectionRedirect extends wallet_connection_with_key_management_1.WalletConnectionWithKeyManagement {
    /**
     * @param {string} walletBaseUrl NEAR wallet URL, used to redirect users to their wallet for signing and sending transactions
    */
    constructor(near, appKeyPrefix, walletBaseUrl) {
        super(near, appKeyPrefix);
        this._walletBaseUrl = walletBaseUrl;
        if (!this.isSignedIn()) {
            this._completeSignInWithAccessKey();
            // TODOD:
            // Emit the same result after redirect, with same data
            // Use local storage to save some data?
            // Event emiting API
            // Attach Event Handler
        }
    }
    /**
     * Redirects current page to the wallet authentication page.
     * @param options An optional options object
     * @param options.contractId The NEAR account where the contract is deployed
     * @param options.successUrl URL to redirect upon success. Default: current url
     * @param options.failureUrl URL to redirect upon failure. Default: current url
     *
     * @example
     * ```js
     * const walletConnection = new WalletConnectionRedirect(near, 'my-app', walletBaseUrl);
     * // redirects to the NEAR Wallet
     * walletConnection.requestSignIn({ contractId: 'account-with-deploy-contract.near' });
     * ```
     */
    async requestSignIn({ contractId, methodNames, successUrl, failureUrl }) {
        const currentUrl = new URL(window.location.href);
        const newUrl = new URL(this._walletBaseUrl + LOGIN_WALLET_URL_SUFFIX);
        newUrl.searchParams.set('success_url', successUrl || currentUrl.href);
        newUrl.searchParams.set('failure_url', failureUrl || currentUrl.href);
        if (contractId) {
            /* Throws exception if contract account does not exist */
            const contractAccount = await this._near.account(contractId);
            await contractAccount.state();
            newUrl.searchParams.set('contract_id', contractId);
            const accessKey = utils_1.KeyPair.fromRandom('ed25519');
            newUrl.searchParams.set('public_key', accessKey.getPublicKey().toString());
            await this._keyStore.setKey(this._networkId, PENDING_ACCESS_KEY_PREFIX + accessKey.getPublicKey(), accessKey);
        }
        if (methodNames) {
            methodNames.forEach(methodName => {
                newUrl.searchParams.append('methodNames', methodName);
            });
        }
        window.location.assign(newUrl.toString());
    }
    /**
     * Requests the user to quickly sign for a transaction or batch of transactions by redirecting to the NEAR wallet.
     */
    async requestSignTransactions({ transactions, meta, callbackUrl }) {
        const currentUrl = new URL(window.location.href);
        const newUrl = new URL('sign', this._walletBaseUrl);
        newUrl.searchParams.set('transactions', transactions
            .map(transaction => borsh_1.serialize(transaction_1.SCHEMA, transaction))
            .map(serialized => Buffer.from(serialized).toString('base64'))
            .join(','));
        newUrl.searchParams.set('callbackUrl', callbackUrl || currentUrl.href);
        if (meta)
            newUrl.searchParams.set('meta', meta);
        window.location.assign(newUrl.toString());
    }
    /**
     * @hidden
     * Complete sign in for a given account id and public key. To be invoked by the app when getting a callback from the wallet.
     */
    async _completeSignInWithAccessKey() {
        const currentUrl = new URL(window.location.href);
        const publicKey = currentUrl.searchParams.get('public_key') || '';
        const allKeys = (currentUrl.searchParams.get('all_keys') || '').split(',');
        const accountId = currentUrl.searchParams.get('account_id') || '';
        // TODO: Handle errors during login
        if (accountId) {
            this._authData = {
                accountId,
                allKeys
            };
            window.localStorage.setItem(this._authDataKey, JSON.stringify(this._authData));
            if (publicKey) {
                await this._moveKeyFromTempToPermanent(accountId, publicKey);
            }
        }
        currentUrl.searchParams.delete('public_key');
        currentUrl.searchParams.delete('all_keys');
        currentUrl.searchParams.delete('account_id');
        currentUrl.searchParams.delete('meta');
        currentUrl.searchParams.delete('transactionHashes');
        window.history.replaceState({}, document.title, currentUrl.toString());
    }
    /**
     * @hidden
     * @param accountId The NEAR account owning the given public key
     * @param publicKey The public key being set to the key store
     */
    async _moveKeyFromTempToPermanent(accountId, publicKey) {
        const keyPair = await this._keyStore.getKey(this._networkId, PENDING_ACCESS_KEY_PREFIX + publicKey);
        await this._keyStore.setKey(this._networkId, accountId, keyPair);
        await this._keyStore.removeKey(this._networkId, PENDING_ACCESS_KEY_PREFIX + publicKey);
    }
    /**
     * Returns the current connected wallet account
     */
    account() {
        if (!this._connectedAccount) {
            this._connectedAccount = new ConnectedWalletAccountRedirect(this, this._near.connection, this._authData.accountId);
        }
        return this._connectedAccount;
    }
}
exports.WalletConnectionRedirect = WalletConnectionRedirect;
/**
 * {@link Account} implementation which redirects to wallet using {@link WalletConnectionRedirect} when no local key is available.
 */
class ConnectedWalletAccountRedirect extends wallet_connection_with_key_management_1.ConnectedWalletAccountWithKeyManagement {
    // Overriding Account methods
    /**
     * Sign a transaction by redirecting to the NEAR Wallet
     * @see {@link WalletConnectionWithKeyManagement.requestSignTransactions}
     */
    async signAndSendTransaction({ receiverId, actions, walletMeta, walletCallbackUrl = window.location.href }) {
        const localKey = await this.connection.signer.getPublicKey(this.accountId, this.connection.networkId);
        let accessKey = await this.accessKeyForTransaction(receiverId, actions, localKey);
        if (!accessKey) {
            throw new Error(`Cannot find matching key for transaction sent to ${receiverId}`);
        }
        if (localKey && localKey.toString() === accessKey.public_key) {
            try {
                return await super.signAndSendTransaction({ receiverId, actions });
            }
            catch (e) {
                if (e.type === 'NotEnoughAllowance') {
                    accessKey = await this.accessKeyForTransaction(receiverId, actions);
                }
                else {
                    throw e;
                }
            }
        }
        const block = await this.connection.provider.block({ finality: 'final' });
        const blockHash = borsh_1.baseDecode(block.header.hash);
        const publicKey = utils_1.PublicKey.from(accessKey.public_key);
        // TODO: Cache & listen for nonce updates for given access key
        const nonce = accessKey.access_key.nonce + 1;
        const transaction = transaction_1.createTransaction(this.accountId, publicKey, receiverId, nonce, actions, blockHash);
        await this.walletConnection.requestSignTransactions({
            transactions: [transaction],
            meta: walletMeta,
            callbackUrl: walletCallbackUrl
        });
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                // TODOD: return an error here that is consistent with injected wallets?
                reject(new Error('Failed to redirect to sign transaction'));
            }, 1000);
        });
        // TODO: Aggregate multiple transaction request with "debounce".
        // TODO: Introduce TrasactionQueue which also can be used to watch for status?
    }
}
exports.ConnectedWalletAccountRedirect = ConnectedWalletAccountRedirect;