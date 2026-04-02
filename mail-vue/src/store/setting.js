import { defineStore } from 'pinia'

export const useSettingStore = defineStore('setting', {
    state: () => ({
        domainList: [],
        loginDomainList: [],
        settings: {
            r2Domain: '',
            loginOpacity: 1.00,
            resendEnabled: 1,
        },
        lang: '',
    }),
    actions: {

    }
})
