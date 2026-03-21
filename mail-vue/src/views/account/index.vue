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
                <el-table-column :label="$t('action')" width="200" fixed="right">
                  <template #default="scope">
                    <el-button size="small" type="primary" @click="openSmtpConfig(scope.row)">
                      {{ $t('smtpSetting') }}
                    </el-button>
                    <el-button size="small" type="danger" @click="deleteAccount(scope.row)" v-if="scope.row.email !== userStore.user.email">
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
    
    <!-- SMTP Config Dialog -->
    <el-dialog v-model="smtpConfigShow" :title="$t('smtpSetting')" width="400">
      <div class="smtp-config-form">
        <div class="setting-item">
          <div><span>{{ $t('smtpOverride') }}</span></div>
          <div>
            <el-switch @change="smtpConfigChange" :active-value="1" :inactive-value="0" v-model="smtpForm.smtpOverride"/>
          </div>
        </div>
        
        <template v-if="smtpForm.smtpOverride">
          <div class="setting-item">
            <div><span>{{ $t('smtpHost') }}</span></div>
            <div>
              <el-input size="small" style="width: 250px" @change="smtpConfigChange" v-model="smtpForm.smtpHost" placeholder="smtp.example.com"/>
            </div>
          </div>
          <div class="setting-item">
            <div><span>{{ $t('smtpPort') }}</span></div>
            <div>
              <el-input-number size="small" @change="smtpConfigChange" v-model="smtpForm.smtpPort" :min="1" :max="65535"/>
            </div>
          </div>
          <div class="setting-item">
            <div><span>{{ $t('smtpUser') }}</span></div>
            <div>
              <el-input size="small" style="width: 250px" @change="smtpConfigChange" v-model="smtpForm.smtpUser" placeholder="user@example.com"/>
            </div>
          </div>
          <div class="setting-item">
            <div><span>{{ $t('smtpPassword') }}</span></div>
            <div>
              <el-input size="small" type="password" show-password style="width: 250px" @change="smtpConfigChange" v-model="smtpForm.smtpPassword"/>
            </div>
          </div>
          <div class="setting-item">
            <div><span>{{ $t('smtpSecure') }}</span></div>
            <div>
              <el-select size="small" @change="smtpConfigChange" style="width: 120px" v-model="smtpForm.smtpSecure">
                <el-option :value="0" label="STARTTLS"/>
                <el-option :value="1" label="SSL/TLS"/>
              </el-select>
            </div>
          </div>
          <div class="setting-item">
            <div><span>{{ $t('smtpAuthType') }}</span></div>
            <div>
              <el-select size="small" @change="smtpConfigChange" style="width: 120px" v-model="smtpForm.smtpAuthType">
                <el-option value="plain" label="Plain"/>
                <el-option value="login" label="Login"/>
                <el-option value="cram-md5" label="CRAM-MD5"/>
              </el-select>
            </div>
          </div>
          <div class="setting-item">
            <div><span>{{ $t('smtpVerify') }}</span></div>
            <div>
              <el-button size="small" type="primary" :loading="smtpVerifying" @click="verifySmtpConfig">
                {{ $t('test') }}
              </el-button>
            </div>
          </div>
        </template>
        
        <!-- 邮件签名设置 -->
        <div class="setting-item">
          <div><span>邮件签名</span></div>
          <div>
            <el-input
              type="textarea"
              rows="4"
              style="width: 250px"
              @change="smtpConfigChange"
              v-model="smtpForm.signature"
              placeholder="输入邮件签名内容，支持HTML格式"
            />
            <div style="font-size: 12px; color: #999; margin-top: 5px;">
              提示：签名将在发送邮件时自动添加到邮件末尾
            </div>
          </div>
        </div>
      </div>
    </el-dialog>
  </div>
</template>
<script setup>
import {reactive, ref, onMounted} from 'vue'
import {accountAdd, accountDelete, accountList as fetchAccountList} from "@/request/account.js"
import {useUserStore} from "@/store/user.js"
import {Icon} from "@iconify/vue"
import LoadingComponent from "@/components/loading/index.vue"
import {getSmtpAccountConfig, saveSmtpAccountConfig, verifySmtpAccountConfig} from "@/request/setting.js"
import {useI18n} from 'vue-i18n'

const { t } = useI18n()
const userStore = useUserStore()
const loading = ref(true)
const addAccountShow = ref(false)
const smtpConfigShow = ref(false)
const addLoading = ref(false)
const smtpVerifying = ref(false)
const currentAccount = ref(null)

const addForm = reactive({
  email: ''
})

const smtpForm = reactive({
  smtpOverride: 0,
  smtpHost: '',
  smtpPort: 587,
  smtpUser: '',
  smtpPassword: '',
  smtpSecure: 0,
  smtpAuthType: 'plain',
  signature: ''
})

const accountList = ref([])

onMounted(() => {
  loadAccounts()
})

async function loadAccounts() {
  loading.value = true
  try {
    const data = await fetchAccountList()
    accountList.value = data.map(item => ({
      ...item,
      createTime: new Date(item.createTime).toLocaleString()
    }))
  } finally {
    loading.value = false
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
    await accountAdd({ email: addForm.email })
    ElMessage({
      message: t('addSuccessMsg'),
      type: 'success',
      plain: true
    })
    addAccountShow.value = false
    addForm.email = ''
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
    await accountDelete({ accountId: account.accountId })
    ElMessage({
      message: t('deleteSuccessMsg'),
      type: 'success',
      plain: true
    })
    await loadAccounts()
  })
}

async function openSmtpConfig(account) {
  currentAccount.value = account
  smtpConfigShow.value = true
  
  try {
    const config = await getSmtpAccountConfig(account.accountId)
    Object.assign(smtpForm, config)
  } catch (error) {
    console.error('获取SMTP配置失败:', error)
  }
}

function smtpConfigChange() {
  if (currentAccount.value) {
    saveSmtpConfig()
  }
}

async function saveSmtpConfig() {
  if (!currentAccount.value) return
  
  try {
    await saveSmtpAccountConfig(currentAccount.value.accountId, smtpForm)
  } catch (error) {
    console.error('保存SMTP配置失败:', error)
  }
}

async function verifySmtpConfig() {
  if (!currentAccount.value || !smtpForm.smtpOverride) return
  
  smtpVerifying.value = true
  try {
    const result = await verifySmtpAccountConfig(currentAccount.value.accountId, smtpForm)
    if (result.success) {
      ElMessage({
        message: t('smtpConnectSuccess'),
        type: 'success',
        plain: true
      })
    } else {
      ElMessage({
        message: t('smtpConnectFailed') + ': ' + result.message,
        type: 'error',
        plain: true
      })
    }
  } catch (error) {
    ElMessage({
      message: t('smtpConnectFailed') + ': ' + error.message,
      type: 'error',
      plain: true
    })
  } finally {
    smtpVerifying.value = false
  }
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
  
  .smtp-config-form {
    .setting-item {
      display: grid;
      grid-template-columns: 120px 1fr;
      gap: 10px;
      margin-bottom: 15px;
      align-items: center;
      
      div:first-child {
        font-weight: bold;
      }
    }
  }
}
</style>