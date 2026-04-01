    import { defineStore } from 'pinia'

export const useAccountStore = defineStore('account', {
    state: () => ({
        currentAccountId: 0,
        currentAccount: {},
        changeUserAccountName: '',
        accountListUpdated: 0
    }),
    actions: {
        triggerRefresh() {
            this.accountListUpdated++
        }
    }
})