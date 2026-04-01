<template>
  <div class="account-container">
    <div class="loading" :class="loading ? 'loading-show' : 'loading-hide'">
      <LoadingComponent/>
    </div>
    <el-scrollbar class="scroll" v-if="!loading">
      <div class="scroll-body">
        <div class="card-grid">
          <!-- Account List Card -->
          <div class="settings-card">
            <div class="card-title">{{ $t('emailAccounts') }}</div>
            <div class="card-content">
              <el-table :data="accountList" style="width: 100%">
                <el-table-column prop="name" :label="$t('accountName')" width="180"/>
                <el-table-column prop="email" :label="$t('emailAccount')" min-width="200"/>
                <el-table-column prop="status" :label="$t('status')" width="120">
                  <template #default="scope">
                    <el-tag :type="scope.row.status === 0 ? 'success' : 'danger'">
                      {{ scope.row.status === 0 ? $t('enabled') : $t('disabled') }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="createTime" :label="$t('createTime')" width="180"/>
                <el-table-column :label="$t('action')" width="220" fixed="right">
                  <template #default="scope">
                    <el-button size="small" type="primary" @click="openSmtpAccountManager(scope.row)" v-perm="'smtp:set'">
                      {{ $t('smtpSetting') }}
                    </el-button>
                    <el-button
                      size="small"
                      type="warning"
                      :loading="retryingAccountId === scope.row.accountId"
                      @click="retryMailcow(scope.row)"
                      v-if="canRetryMailcow(scope.row)"
                    >
                      重试
                    </el-button>
                    <el-button size="small" type="danger" @click="deleteAccount(scope.row)" v-if="scope.row.email !== userStore.user.email" v-perm="'account:delete'">
                      {{ $t('delete') }}
                    </el-button>
                  </template>
                </el-table-column>
              </el-table>
              
              <div class="add-account" v-perm="'account:add'">
                <el-button type="primary" @click="addAccountShow = true">
                  <Icon icon="material-symbols:add-rounded" width="16" height="16"/>
                  {{ $t('addAccount') }}
                </el-button>
              </div>
            </div>
          </div>
          <!-- All User Accounts Card (admin only) -->
          <div class="settings-card" v-if="isAdmin">
            <div class="card-title">{{ $t('allUserAccounts') }}</div>
            <div class="card-content">
              <div class="global-filter-row">
                <el-input
                  v-model="globalParams.email"
                  :placeholder="$t('searchEmail')"
                  clearable
                  style="width: 220px"
                  @keyup.enter="searchGlobalAccounts"
                />
                <el-select v-model="globalParams.smtpStatus" style="width: 140px" @change="searchGlobalAccounts">
                  <el-option value="" :label="$t('filterAll')" />
                  <el-option value="configured" :label="$t('smtpConfigured')" />
                  <el-option value="unconfigured" :label="$t('smtpUnconfigured')" />
                </el-select>
                <el-button type="primary" @click="searchGlobalAccounts">
                  <Icon icon="iconoir:search" width="16" height="16" />
                </el-button>
              </div>
              <el-table :data="globalAccountList" style="width: 100%" v-loading="globalLoading">
                <el-table-column prop="email" :label="$t('emailAccount')" min-width="200">
                  <template #default="scope">
                    <span style="word-break: break-all">{{ scope.row.email }}</span>
                  </template>
                </el-table-column>
                <el-table-column prop="userEmail" :label="$t('belongUser')" min-width="180">
                  <template #default="scope">
                    <span style="color: var(--el-text-color-secondary)">{{ scope.row.userEmail }}</span>
                  </template>
                </el-table-column>
                <el-table-column :label="$t('smtpStatus')" width="160">
                  <template #default="scope">
                    <el-tag v-if="scope.row.smtpAccountCount > 0 && scope.row.mailcowServerId" type="success" size="small">
                      {{ $t('smtpMailcow') }}
                    </el-tag>
                    <el-tag v-else-if="scope.row.smtpAccountCount > 0" type="primary" size="small">
                      {{ $t('smtpManual') }}
                    </el-tag>
                    <el-tag v-else type="info" size="small">
                      {{ $t('smtpUnconfigured') }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column :label="$t('action')" width="160" fixed="right">
                  <template #default="scope">
                    <el-dropdown trigger="click">
                      <el-button type="primary" size="small">{{ $t('action') }}</el-button>
                      <template #dropdown>
                        <el-dropdown-menu>
                          <el-dropdown-item @click="openGlobalSmtpManager(scope.row)">
                            {{ $t('smtpSetting') }}
                          </el-dropdown-item>
                          <el-dropdown-item
                            v-if="mailcowEnabled && globalMailcowServers.length > 0"
                            @click="provisionGlobalAccount(scope.row)"
                          >
                            {{ $t('oneClickProvision') }}
                          </el-dropdown-item>
                          <el-dropdown-item @click="deleteGlobalAccount(scope.row)">
                            {{ $t('delete') }}
                          </el-dropdown-item>
                        </el-dropdown-menu>
                      </template>
                    </el-dropdown>
                  </template>
                </el-table-column>
              </el-table>
              <div class="global-pagination" v-if="globalTotal > 0">
                <el-pagination
                  background
                  layout="prev, pager, next, total"
                  :total="globalTotal"
                  :page-size="globalParams.size"
                  :current-page="globalParams.num"
                  @current-change="globalPageChange"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </el-scrollbar>
    
    <!-- Add Account Dialog -->
    <el-dialog v-model="addAccountShow" :title="$t('addAccount')" width="340">
      <div class="add-account-form">
        <el-input v-model="addForm.email" :placeholder="$t('emailAccount')"/>
        <el-button type="primary" :loading="addLoading" @click="addAccount">{{ $t('add') }}</el-button>
      </div>
    </el-dialog>
    
    <smtpAccountManager ref="smtpAccountManagerRef" :account-id="smtpManagerAccountId" />
  </div>
</template>
<script setup>
import {reactive, ref, computed, onMounted, nextTick} from 'vue'
import {accountAdd, accountDelete, accountList as fetchAccountList, accountRetryMailcow, accountProvisionSmtpByMailcowServer} from "@/request/account.js"
import {useAccountStore} from "@/store/account.js"
import {useUserStore} from "@/store/user.js"

import {Icon} from "@iconify/vue"
import LoadingComponent from "@/components/loading/index.vue"
import smtpAccountManager from "@/components/smtp-account-manager/index.vue"
import {settingQuery} from "@/request/setting.js"
import {adminAccountList} from "@/request/admin.js"
import {userDeleteAccount} from "@/request/user.js"
import {smtpMailcowServers} from "@/request/smtp.js"
import {useI18n} from 'vue-i18n'
import {ElMessage, ElMessageBox} from 'element-plus'

const { t } = useI18n()
const accountStore = useAccountStore()
const userStore = useUserStore()

const loading = ref(true)
const addAccountShow = ref(false)
const addLoading = ref(false)
const mailcowEnabled = ref(false)
const retryingAccountId = ref(0)
const smtpAccountManagerRef = ref()
const smtpManagerAccountId = ref(0)

const addForm = reactive({
  email: ''
})

const accountList = ref([])

onMounted(() => {
  loadAccounts()
})

async function loadAccounts() {
  loading.value = true
  try {
    const isAdmin = userStore.user.type === 0
    const promises = [fetchAccountList()]
    if (isAdmin) promises.push(settingQuery())
    const [data, settingData] = await Promise.all(promises)
    accountList.value = data.map(item => ({
      ...item,
      createTime: new Date(item.createTime).toLocaleString()
    }))
    if (settingData) {
      mailcowEnabled.value = Number(settingData.mailcowEnabled || 0) === 1
    } else {
      mailcowEnabled.value = false
    }
  } finally {
    loading.value = false
  }
}

function canRetryMailcow(account) {
  if (!mailcowEnabled.value) return false
  return Number(account.smtpOverride || 0) !== 1
}

async function retryMailcow(account) {
  retryingAccountId.value = account.accountId
  try {
    await accountRetryMailcow(account.accountId)
    ElMessage({
      message: 'Mailcow 重试成功',
      type: 'success',
      plain: true
    })
    await loadAccounts()
  } catch (error) {
    ElMessage({
      message: error?.message || 'Mailcow 重试失败',
      type: 'error',
      plain: true
    })
  } finally {
    retryingAccountId.value = 0
  }
}

async function addAccount() {
  if (!addForm.email) {
    ElMessage({
      message: t('emptyEmail'),
      type: 'error',
      plain: true
    })
    return
  }
  
  addLoading.value = true
  try {
    await accountAdd(addForm.email)
    ElMessage({
      message: t('addSuccessMsg'),
      type: 'success',
      plain: true
    })
    addAccountShow.value = false
    addForm.email = ''
    accountStore.triggerRefresh()
    await loadAccounts()
  } finally {
    addLoading.value = false
  }
}

async function deleteAccount(account) {
  ElMessageBox.confirm(t('deleteAccountConfirm'), {
    confirmButtonText: t('confirm'),
    cancelButtonText: t('cancel'),
    type: 'warning'
  }).then(async () => {
    await accountDelete(account.accountId)
    ElMessage({
      message: t('deleteSuccessMsg'),
      type: 'success',
      plain: true
    })
    accountStore.triggerRefresh()
    await loadAccounts()
  })
}

function openSmtpAccountManager(account) {
  smtpManagerAccountId.value = account.accountId
  nextTick(() => {
    smtpAccountManagerRef.value.open()
  })
}

// ---- Global Accounts (admin only) ----
const isAdmin = computed(() => userStore.user.type === 0)
const globalAccountList = ref([])
const globalLoading = ref(false)
const globalTotal = ref(0)
const globalMailcowServers = ref([])

const globalParams = reactive({
  email: '',
  smtpStatus: '',
  num: 1,
  size: 15
})

onMounted(() => {
  if (isAdmin.value) {
    loadGlobalAccounts()
    loadMailcowServers()
  }
})

async function loadGlobalAccounts() {
  globalLoading.value = true
  try {
    const data = await adminAccountList(globalParams)
    globalAccountList.value = data.list
    globalTotal.value = data.total
  } finally {
    globalLoading.value = false
  }
}

async function loadMailcowServers() {
  try {
    const servers = await smtpMailcowServers()
    globalMailcowServers.value = Array.isArray(servers) ? servers : []
  } catch {
    globalMailcowServers.value = []
  }
}

function searchGlobalAccounts() {
  globalParams.num = 1
  loadGlobalAccounts()
}

function globalPageChange(num) {
  globalParams.num = num
  loadGlobalAccounts()
}

function openGlobalSmtpManager(account) {
  smtpManagerAccountId.value = account.accountId
  nextTick(() => {
    smtpAccountManagerRef.value.open()
  })
}

async function provisionGlobalAccount(account) {
  const serverId = globalMailcowServers.value[0]?.id
  if (!serverId) return
  try {
    await accountProvisionSmtpByMailcowServer(account.accountId, serverId)
    ElMessage({ message: t('provisionSuccess'), type: 'success', plain: true })
    await loadGlobalAccounts()
  } catch (error) {
    ElMessage({ message: error?.message || t('provisionFailed'), type: 'error', plain: true })
  }
}

async function deleteGlobalAccount(account) {
  ElMessageBox.confirm(t('deleteAccountConfirmMsg', { email: account.email }), {
    confirmButtonText: t('confirm'),
    cancelButtonText: t('cancel'),
    type: 'warning'
  }).then(async () => {
    await userDeleteAccount(account.accountId)
    ElMessage({ message: t('deleteSuccess'), type: 'success', plain: true })
    await loadGlobalAccounts()
  })
}
</script>
<style scoped lang="scss">
.account-container {
  padding: 40px 40px;
  
  @media (max-width: 767px) {
    padding: 30px 30px;
  }
  
  .loading {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(255, 255, 255, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    opacity: 0;
    transition: opacity 0.3s;
    
    &.loading-show {
      opacity: 1;
    }
    
    &.loading-hide {
      opacity: 0;
      pointer-events: none;
    }
  }
  
  .scroll {
    height: calc(100vh - 120px);
    
    .scroll-body {
      padding-bottom: 40px;
    }
  }
  
  .card-grid {
    display: grid;
    gap: 30px;
  }
  
  .settings-card {
    background: var(--el-bg-color);
    border-radius: 8px;
    box-shadow: var(--el-box-shadow-light);
    padding: 20px;
    
    .card-title {
      font-size: 18px;
      font-weight: bold;
      margin-bottom: 20px;
    }
    
    .card-content {
      .add-account {
        margin-top: 20px;
        text-align: right;
      }
    }
  }
  
  .add-account-form {
    display: flex;
    flex-direction: column;
    gap: 15px;
  }
  
  .global-filter-row {
    display: flex;
    gap: 10px;
    margin-bottom: 15px;
    flex-wrap: wrap;
    align-items: center;
  }
  
  .global-pagination {
    margin-top: 15px;
    display: flex;
    justify-content: flex-end;
  }
}
</style>