// Copyright 2018 Superblocks AB
//
// This file is part of Superblocks Lab.
//
// Superblocks Lab is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation version 3 of the License.
//
// Superblocks Lab is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with Superblocks Lab.  If not, see <http://www.gnu.org/licenses/>.

import Web3 from 'web3';
import Tx from 'ethereumjs-tx';
import Buffer from 'buffer';
import { evmService, walletService } from '../../services';
import { IEnvironment, IAccount } from '../../models/state';

export default class SuperProvider {
    private readonly channelId: string;
    private readonly notifyTx: (hash: string, endpoint: string) => void;
    private selectedAccount: IAccount;
    private selectedEnvironment: IEnvironment;
    private iframe: any;
    private iframeStatus: number;

    constructor(channelId: string, environment: IEnvironment, account: IAccount, notifyTx: (hash: string, endpoint: string) => void) {
        this.channelId = channelId;
        this.selectedEnvironment = environment;
        this.selectedAccount = account;
        this.notifyTx = notifyTx;
        this.iframe = null;
        this.iframeStatus = -1;
    }

    initIframe(iframe: any) {
        this.iframe = iframe;
        this.iframeStatus = -1;
        this.initializeIFrame();
    }

    attachListener() {
        window.addEventListener('message', this.onMessage);
    }

    detachListener() {
        window.removeEventListener('message', this.onMessage);
    }

    setEnvironment(environment: IEnvironment) {
        this.selectedEnvironment = environment;
    }

    setAccount(account: IAccount) {
        this.selectedAccount = account;
    }

    private send = (payload: any, endpoint: string) => {
        // Send request on given endpoint
        // TODO: possibly set from and gasLimit.
        return new Promise(async (resolve, reject) => {
            if (endpoint.toLowerCase() === 'http://superblocks-browser') {
                try {
                    const result = await evmService.getProvider().sendAsync(payload);
                    resolve(result);
                } catch (e) {
                    console.log(e);
                    reject('Problem calling the provider async call');
                }

            } else {
                fetch(endpoint, {
                    body: JSON.stringify(payload),
                    headers: {
                        'content-type': 'application/json',
                    },
                    method: 'POST',
                })
                .then(response => {
                    if (!response.ok) {
                        if (response.status === 405) {
                            reject('Method not supported by remote endpoint.');
                        }
                        reject('Could not communicate with remote endpoint.');
                    }
                    resolve(response.json());
                })
                .catch(() => {
                    reject('Error running method remotely.');
                });
            }
        });
    }

    private onMessage = async (event: any) => {
        // There's no point checking origin here since the iframe is running it's own code already,
        // we need to treat it as a suspect.
        // if (event.origin !== "null") {
        // console.log("Origin diff", event.origin);
        // return;
        // }
        const data = event.data;
        if (typeof data !== 'object') { return; }
        if (data.channel !== this.channelId) { return; }
        if (data.type === 'ack') {
            this.iframeStatus = 0;
            return;
        }

        const sendIframeMessage = (err: any, res: any) => {
            // console.log(err,res);
            if (
                (data.payload.method === 'eth_sendTransaction' ||
                    data.payload.method === 'eth_sendRawTransaction') &&
                !err &&
                res &&
                res.result &&
                this.notifyTx
            ) {
                this.notifyTx(res.result, data.endpoint);
            }
            try {
                this.iframe.contentWindow.postMessage({
                    type: 'reply',
                    channel: this.channelId,
                    id: data.id,
                    payload: { err, res },
                }, '*');
            } catch (e) {
                console.log(e);
            }
        };

        const payload = data.payload;
        if (payload.method === 'eth_sendTransaction') {
            // Needs signing
            const accountName = this.selectedAccount.name;
            if (!accountName || accountName === '(absent)' || accountName === '(locked)') {
                const err = 'No account provided.';
                alert(err);
                sendIframeMessage(err, null);
                return;
            }
            // const accounts = this.projectItem.getHiddenItem('accounts');
            // const account = accounts.getByName(accountName);

            // const env = this.getCurrentEnv();
            // const walletName = account.getWallet(env);

            // const wallets = this.projectItem.getHiddenItem('wallets');
            // const wallet = wallets.getByName(walletName);

            // if (!wallet) {
            //     const err = 'Wallet not found.';
            //     alert(err);
            //     callback(err, null);
            //     return;
            // }

            if (this.selectedAccount.type === 'external') {
                if (data.endpoint.toLowerCase() === 'http://superblocks-browser') {
                    const err = 'External/Metamask account cannot be used for the in-browser blockchain.';
                    alert(err);
                    sendIframeMessage(err, null);
                    return;
                }
                // Pass to External/Metamask
                if (window.web3.currentProvider) {
                    // TODO is there any way to check what endpoint Metamask is configured for
                    // and verify that it matches out expected endpoint?
                    if ((window.web3.eth.accounts || []).length === 0) {
                        const err = 'External/Metamask provider is locked. Cannot proceed.';
                        alert(err);
                        sendIframeMessage(err, null);
                        return;
                    }
                    // const modalData = {
                    //     title: 'WARNING: Invoking external account provider',
                    //     body:
                    //         'Please understand that Superblocks Lab has no power over which network is targeted when using an external provider. It is your responsibility that the network is the same as it is expected to be.',
                    //     style: {
                    //         backgroundColor: '#cd5c5c',
                    //         color: '#fef7ff',
                    //     },
                    // };
                    // const modal = <Modal data= {modalData}; />;
                    // this.projectItem.functions.modal.show({
                    //     cancel: () => {
                    //         return false;
                    //     },
                    //     render: () => {
                    //         return modal;
                    //     },
                    // });

                    // TODO - Fix this
                    // window.web3.currentProvider.sendAsync(data.payload,(err, res) => {
                    //         this.projectItem.functions.modal.close();
                    //         callback(err, res);
                    //     }
                    // );
                    return;
                } else {
                    const err = "Metamask plugin is not installed, can't proceed.";
                    alert(err);
                    sendIframeMessage(err, null);
                    return;
                }
            } else {
                const obj = payload.params[payload.params.length - 1];
                const wallet = await walletService.openWallet(this.selectedAccount.name, null, null);
                // if (status !== 0) {
                //     const err = 'Could not open wallet.';
                //     callback(err, null);
                //     return;
                // }

                const nonce = await this.getNonce(this.selectedEnvironment.endpoint, this.selectedAccount.address);
                const tx = new Tx({
                    from: this.selectedAccount.address,
                    to: obj.to,
                    value: obj.value,
                    nonce,
                    gasPrice: obj.gasPrice,
                    gasLimit: obj.gas,
                    data: obj.data,
                });
                tx.sign(Buffer.Buffer.from(wallet.secret.key.toString(), 'hex'));
                const obj3 = {
                    jsonrpc: '2.0',
                    method: 'eth_sendRawTransaction',
                    params: ['0x' + tx.serialize().toString('hex')],
                    id: payload.id,
                };
                this.send(obj3, data.endpoint);
            }
        } else {
            this.send(data.payload, data.endpoint);
        }
    }

    private getWeb3 = (endpoint: string) => {
        let provider;
        if (endpoint.toLowerCase() === 'http://superblocks-browser') {
            provider = evmService.getProvider();
        } else {
            provider = new Web3.providers.HttpProvider(endpoint);
        }
        return new Web3(provider);
    }

    private getNonce = async (endpoint: string, address: Nullable<string>) => {
        if (address === null) {
            throw Error('The address cannot be empty');
        }
        const web3 = this.getWeb3(endpoint);
        return await web3.eth.getTransactionCount(address);
    }

    private initializeIFrame = () => {
        if (this.iframeStatus === 0) { return; }
        if (this.iframe.contentWindow) {
            this.iframe.contentWindow.postMessage(
                { type: 'init', channel: this.channelId },
                '*'
            );
        }
        setTimeout(this.initializeIFrame, 1000);
    }
}
