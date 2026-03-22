import { defineStore } from 'pinia'

export const useSettingStore = defineStore('setting', {
    state: () => ({
        domainList: [],
        settings: {
            r2Domain: '',
            loginOpacity: 1.00,
            resendEnabled: true,
        },
        lang: '',
    }),
    actions: {

    }
})
