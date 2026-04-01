<template>
  <!-- SMTP账户管理对话框 -->
  <el-dialog v-model="managerShow" :title="$t('smtpSetting')" width="600">
    <div class="smtp-account-manager">
      <div class="smtp-account-header">
        <div class="smtp-provision-row" v-if="showProvision">
          <el-select v-model="provisionMailcowServerId" size="small" style="width: 260px" :placeholder="$t('selectMailcowServer')">
            <el-option
              v-for="server in availableMailcowServers"
              :key="server.id"
              :label="server.name || server.apiUrl"
              :value="server.id"
            />
          </el-select>
          <el-button
            type="warning"
            size="small"
            :loading="provisioningLoading"
            :disabled="!provisionMailcowServerId"
            @click="provisionSmtpFromSelectedMailcow"
          >
            {{ $t('oneClickProvisionSmtp') }}
          </el-button>
        </div>
        <el-button type="primary" size="small" @click="addSmtpAccount">
          {{ $t('addSmtpAccount') }}
        </el-button>
      </div>
      <el-divider/>
      <div class="smtp-account-list" v-if="smtpAccounts.length > 0">
        <div class="smtp-account-item" v-for="account in smtpAccounts" :key="account.smtpAccountId">
          <div class="smtp-account-info">
            <div class="smtp-account-name">
              {{ account.name }}
              <el-tag v-if="account.isDefault" size="small" type="success">{{ $t('default') }}</el-tag>
            </div>
            <div class="smtp-account-details">
              <div>{{ account.host }}:{{ account.port }}</div>
              <div>{{ account.user }}</div>
              <div>{{ account.secure === 1 ? 'SSL/TLS' : 'STARTTLS' }}</div>
            </div>
          </div>
          <div class="smtp-account-actions">
            <el-button size="small" @click="editSmtpAccount(account)">{{ $t('edit') }}</el-button>
            <el-button size="small" @click="setDefaultSmtpAccount(account)" v-if="!account.isDefault">{{ $t('setDefault') }}</el-button>
            <el-button size="small" type="danger" @click="deleteSmtpAccount(account)">{{ $t('delete') }}</el-button>
          </div>
        </div>
      </div>
      <div class="smtp-account-empty" v-else>
        <el-empty :description="$t('noSmtpAccounts')" />
      </div>
    </div>
  </el-dialog>

  <!-- SMTP账户编辑对话框 -->
  <el-dialog v-model="editShow" :title="editingSmtpAccount ? $t('editSmtpAccount') : $t('addSmtpAccount')" width="500">
    <div class="smtp-account-edit-form">
      <el-form :model="smtpAccountForm" label-width="100px">
        <el-form-item :label="$t('smtpAccountName')">
          <el-input v-model="smtpAccountForm.name" :placeholder="$t('smtpAccountNamePlaceholder')" />
        </el-form-item>
        <el-form-item :label="$t('smtpHost')">
          <el-input v-model="smtpAccountForm.host" placeholder="smtp.example.com" />
        </el-form-item>
        <el-form-item :label="$t('smtpPort')">
          <el-input-number v-model="smtpAccountForm.port" :min="1" :max="65535" />
        </el-form-item>
        <el-form-item :label="$t('smtpUser')">
          <el-input v-model="smtpAccountForm.user" placeholder="user@example.com" />
        </el-form-item>
        <el-form-item :label="$t('smtpPassword')">
          <el-input type="password" show-password v-model="smtpAccountForm.password" />
        </el-form-item>
        <el-form-item :label="$t('smtpEncryption')">
          <el-select v-model="smtpAccountForm.secure">
            <el-option :value="0" label="STARTTLS"/>
            <el-option :value="1" label="SSL/TLS"/>
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('smtpAuthType')">
          <el-select v-model="smtpAccountForm.authType">
            <el-option value="plain" label="Plain"/>
            <el-option value="login" label="Login"/>
            <el-option value="cram-md5" label="CRAM-MD5"/>
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-checkbox v-model="smtpAccountForm.isDefault">{{ $t('setDefault') }}</el-checkbox>
        </el-form-item>
      </el-form>
      <div style="margin-top: 20px;">
        <el-button type="primary" :loading="verifying" @click="verifySmtpAccountLocal">
          {{ $t('test') }}
        </el-button>
      </div>
    </div>
    <template #footer>
      <span class="dialog-footer">
        <el-button @click="editShow = false">{{ $t('cancel') }}</el-button>
        <el-button type="primary" @click="saveSmtpAccount">{{ $t('save') }}</el-button>
      </span>
    </template>
  </el-dialog>
</template>

<script setup>
import {reactive, ref, computed} from "vue"
import {useI18n} from "vue-i18n"
import {ElMessage, ElMessageBox} from "element-plus"
import {smtpAccountList, smtpAccountCreate, smtpAccountUpdate, smtpAccountDelete, smtpAccountVerify, smtpMailcowServers, smtpDeleteMailcowAccount} from "@/request/smtp.js"
import {accountProvisionSmtpByMailcowServer} from "@/request/account.js"
import {hasPerm} from "@/perm/perm.js"

const props = defineProps({
  accountId: {
    type: Number,
    required: true
  }
})

const {t} = useI18n()

const managerShow = ref(false)
const editShow = ref(false)
const smtpAccounts = ref([])
const editingSmtpAccount = ref(null)
const verifying = ref(false)
const mailcowEnabled = ref(false)
const availableMailcowServers = ref([])
const provisionMailcowServerId = ref('')
const provisioningLoading = ref(false)
const showProvision = computed(() => mailcowEnabled.value && availableMailcowServers.value.length > 0 && hasPerm('smtp:provision'))
const smtpAccountForm = reactive({
  name: '',
  host: '',
  port: 587,
  user: '',
  password: '',
  secure: 0,
  authType: 'plain',
  isDefault: false
})

async function open() {
  managerShow.value = true
  try {
    const data = await smtpAccountList(props.accountId)
    smtpAccounts.value = data
  } catch (error) {
    console.error('获取SMTP账户列表失败:', error)
    ElMessage({message: t('smtpLoadFailed'), type: 'error', plain: true})
  }
  // 加载Mailcow服务器列表（所有用户均可访问，显示由权限控制）
  try {
    const mcData = await smtpMailcowServers()
    mailcowEnabled.value = !!mcData.mailcowEnabled
    availableMailcowServers.value = Array.isArray(mcData.mailcowServers) ? mcData.mailcowServers : []
    if (!provisionMailcowServerId.value && availableMailcowServers.value.length > 0) {
      const defaultServer = availableMailcowServers.value.find(item => item?.isDefault)
      provisionMailcowServerId.value = defaultServer?.id || availableMailcowServers.value[0]?.id || ''
    }
  } catch (error) {
    console.error('获取Mailcow服务器列表失败:', error)
  }
}

function addSmtpAccount() {
  editingSmtpAccount.value = null
  smtpAccountForm.name = ''
  smtpAccountForm.host = ''
  smtpAccountForm.port = 587
  smtpAccountForm.user = ''
  smtpAccountForm.password = ''
  smtpAccountForm.secure = 0
  smtpAccountForm.authType = 'plain'
  smtpAccountForm.isDefault = false
  editShow.value = true
}

function editSmtpAccount(account) {
  editingSmtpAccount.value = account
  smtpAccountForm.name = account.name
  smtpAccountForm.host = account.host
  smtpAccountForm.port = account.port
  smtpAccountForm.user = account.user
  smtpAccountForm.password = ''
  smtpAccountForm.secure = account.secure
  smtpAccountForm.authType = account.authType
  smtpAccountForm.isDefault = account.isDefault === 1
  editShow.value = true
}

async function saveSmtpAccount() {
  if (!smtpAccountForm.name || !smtpAccountForm.host || !smtpAccountForm.user || !smtpAccountForm.password) {
    ElMessage({message: t('smtpFormIncomplete'), type: 'error', plain: true})
    return
  }

  try {
    const formData = {...smtpAccountForm, accountId: props.accountId}
    if (editingSmtpAccount.value) {
      await smtpAccountUpdate(editingSmtpAccount.value.smtpAccountId, formData)
      ElMessage({message: t('smtpUpdateSuccess'), type: 'success', plain: true})
    } else {
      await smtpAccountCreate(formData)
      ElMessage({message: t('smtpAddSuccess'), type: 'success', plain: true})
    }
    const data = await smtpAccountList(props.accountId)
    smtpAccounts.value = data
    editShow.value = false
  } catch (error) {
    console.error('保存SMTP账户失败:', error)
    ElMessage({message: t('smtpSaveFailed'), type: 'error', plain: true})
  }
}

async function deleteSmtpAccount(account) {
  ElMessageBox.confirm(t('smtpDeleteConfirm'), {
    confirmButtonText: t('confirm'),
    cancelButtonText: t('cancel'),
    type: 'warning'
  }).then(async () => {
    try {
      await smtpAccountDelete(account.smtpAccountId, props.accountId)
      ElMessage({message: t('smtpDeleteSuccess'), type: 'success', plain: true})
      const data = await smtpAccountList(props.accountId)
      smtpAccounts.value = data
    } catch (error) {
      console.error('删除SMTP账户失败:', error)
      ElMessage({message: t('smtpDeleteFailed'), type: 'error', plain: true})
      return
    }
    // 删除SMTP配置后，询问是否同时删除Mailcow服务器账户
    if (mailcowEnabled.value) {
      ElMessageBox.confirm(t('deleteMailcowAccountConfirm'), {
        confirmButtonText: t('confirm'),
        cancelButtonText: t('cancel'),
        type: 'warning'
      }).then(async () => {
        try {
          await smtpDeleteMailcowAccount(props.accountId)
          ElMessage({message: t('deleteMailcowAccountSuccess'), type: 'success', plain: true})
        } catch (error) {
          console.error('删除Mailcow账户失败:', error)
          ElMessage({message: error?.message || t('deleteMailcowAccountFailed'), type: 'error', plain: true})
        }
      }).catch(() => {})
    }
  })
}

async function setDefaultSmtpAccount(account) {
  try {
    await smtpAccountUpdate(account.smtpAccountId, {
      ...account,
      accountId: props.accountId,
      isDefault: true
    })
    ElMessage({message: t('smtpSetDefaultSuccess'), type: 'success', plain: true})
    const data = await smtpAccountList(props.accountId)
    smtpAccounts.value = data
  } catch (error) {
    console.error('设置默认SMTP账户失败:', error)
    ElMessage({message: t('smtpSetDefaultFailed'), type: 'error', plain: true})
  }
}

async function verifySmtpAccountLocal() {
  verifying.value = true
  try {
    const result = await smtpAccountVerify(props.accountId, smtpAccountForm)
    if (result.success) {
      ElMessage({message: t('smtpConnectSuccess'), type: 'success', plain: true})
    } else {
      ElMessage({message: t('smtpConnectFailed') + ': ' + result.message, type: 'error', plain: true})
    }
  } catch (error) {
    ElMessage({message: t('smtpConnectFailed') + ': ' + error.message, type: 'error', plain: true})
  } finally {
    verifying.value = false
  }
}

async function provisionSmtpFromSelectedMailcow() {
  if (!provisionMailcowServerId.value) return
  provisioningLoading.value = true
  try {
    await accountProvisionSmtpByMailcowServer(props.accountId, provisionMailcowServerId.value)
    ElMessage({message: t('smtpProvisionSuccess'), type: 'success', plain: true})
    const data = await smtpAccountList(props.accountId)
    smtpAccounts.value = data
  } catch (error) {
    console.error('一键开通SMTP失败:', error)
    ElMessage({message: error?.message || t('smtpProvisionFailed'), type: 'error', plain: true})
  } finally {
    provisioningLoading.value = false
  }
}

defineExpose({open})
</script>

<style scoped lang="scss">
.smtp-account-manager {
  .smtp-account-header {
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;

    .smtp-provision-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
  }

  .smtp-account-list {
    .smtp-account-item {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: 15px;
      border: 1px solid var(--el-border-color);
      border-radius: 4px;
      margin-bottom: 10px;

      .smtp-account-info {
        flex: 1;

        .smtp-account-name {
          font-weight: bold;
          margin-bottom: 8px;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .smtp-account-details {
          font-size: 14px;
          line-height: 1.5;
          color: var(--el-text-color-secondary);
        }
      }

      .smtp-account-actions {
        display: flex;
        flex-direction: column;
        gap: 5px;
        margin-left: 15px;
      }
    }
  }

  .smtp-account-empty {
    padding: 40px 0;
    text-align: center;
  }
}

.smtp-account-edit-form {
  .el-form {
    max-width: 100%;
  }
}
</style>
