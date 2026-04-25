    import { defineStore } from 'pinia'

export const useAccountStore = defineStore('account', {
    state: () => ({
        currentAccountId: 0,
        currentAccount: {},
        changeUserAccountName: '',
        accountListUpdated: 0,
        accounts: [],
        accountsLoaded: false
    }),
    actions: {
        triggerRefresh() {
            this.accountListUpdated++
        },
        setAccounts(list) {
            this.accounts = list
            this.accountsLoaded = true
        }
    }
})