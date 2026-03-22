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
                <el-table-column :label="$t('action')" width="280" fixed="right">
                  <template #default="scope">
                    <el-button size="small" type="primary" @click="openSmtpConfig(scope.row)" v-perm="'smtp:set'">
                      {{ $t('smtpSetting') }}
                    </el-button>
                    <el-button size="small" type="success" @click="openSmtpAccountManager(scope.row)" v-perm="'smtp:set'">
                      {{ $t('smtpAccountManager') }}
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
        <div v-if="!smtpConfigPermission" class="permission-tip">
          <el-alert
            title="无权限修改SMTP配置"
            type="warning"
            :closable="false"
            show-icon
          />
        </div>
        <div class="setting-item">
          <div><span>{{ $t('smtpOverride') }}</span></div>
          <div>
            <el-switch @change="smtpConfigChange" :active-value="1" :inactive-value="0" v-model="smtpForm.smtpOverride" :disabled="!smtpConfigPermission"/>
          </div>
        </div>
        
        <template v-if="smtpForm.smtpOverride">
          <div class="setting-item">
            <div><span>{{ $t('smtpHost') }}</span></div>
            <div>
              <el-input size="small" style="width: 250px" @change="smtpConfigChange" v-model="smtpForm.smtpHost" placeholder="smtp.example.com" :disabled="!smtpConfigPermission"/>
            </div>
          </div>
          <div class="setting-item">
            <div><span>{{ $t('smtpPort') }}</span></div>
            <div>
              <el-input-number size="small" @change="smtpConfigChange" v-model="smtpForm.smtpPort" :min="1" :max="65535" :disabled="!smtpConfigPermission"/>
            </div>
          </div>
          <div class="setting-item">
            <div><span>{{ $t('smtpUser') }}</span></div>
            <div>
              <el-input size="small" style="width: 250px" @change="smtpConfigChange" v-model="smtpForm.smtpUser" placeholder="user@example.com" :disabled="!smtpConfigPermission"/>
            </div>
          </div>
          <div class="setting-item">
            <div><span>{{ $t('smtpPassword') }}</span></div>
            <div>
              <el-input size="small" type="password" show-password style="width: 250px" @change="smtpConfigChange" v-model="smtpForm.smtpPassword" :disabled="!smtpConfigPermission"/>
            </div>
          </div>
          <div class="setting-item">
            <div><span>{{ $t('smtpSecure') }}</span></div>
            <div>
              <el-select size="small" @change="smtpConfigChange" style="width: 120px" v-model="smtpForm.smtpSecure" :disabled="!smtpConfigPermission">
                <el-option :value="0" label="STARTTLS"/>
                <el-option :value="1" label="SSL/TLS"/>
              </el-select>
            </div>
          </div>
          <div class="setting-item">
            <div><span>{{ $t('smtpAuthType') }}</span></div>
            <div>
              <el-select size="small" @change="smtpConfigChange" style="width: 120px" v-model="smtpForm.smtpAuthType" :disabled="!smtpConfigPermission">
                <el-option value="plain" label="Plain"/>
                <el-option value="login" label="Login"/>
                <el-option value="cram-md5" label="CRAM-MD5"/>
              </el-select>
            </div>
          </div>
          <div class="setting-item">
            <div><span>{{ $t('smtpVerify') }}</span></div>
            <div>
              <el-button size="small" type="primary" :loading="smtpVerifying" @click="verifySmtpConfig" :disabled="!smtpConfigPermission">
                {{ $t('test') }}
              </el-button>
            </div>
          </div>
        </template>
        
        <!-- 邮件签名设置 -->
        <div class="setting-item">
          <div><span>邮件签名</span></div>
          <div>
            <el-button type="primary" size="small" @click="openSignatureManager">
              管理签名
            </el-button>
          </div>
        </div>
      </div>
    </el-dialog>
    
    <!-- 签名管理对话框 -->
    <el-dialog v-model="signatureManagerShow" title="签名管理" width="600">
      <div class="signature-manager">
        <div class="signature-header">
          <el-button type="primary" size="small" @click="addSignature">
            添加签名
          </el-button>
        </div>
        <el-divider/>
        <div class="signature-list" v-if="signatures.length > 0">
          <div class="signature-item" v-for="signature in signatures" :key="signature.id">
            <div class="signature-info">
              <div class="signature-name">
                {{ signature.name }}
                <el-tag v-if="signature.isDefault" size="small" type="success">默认</el-tag>
              </div>
              <div class="signature-content" v-html="signature.content"></div>
            </div>
            <div class="signature-actions">
              <el-button size="small" @click="editSignature(signature)">
                编辑
              </el-button>
              <el-button size="small" @click="setDefaultSignature(signature)" v-if="!signature.isDefault">
                设为默认
              </el-button>
              <el-button size="small" type="danger" @click="deleteSignature(signature)">
                删除
              </el-button>
            </div>
          </div>
        </div>
        <div class="signature-empty" v-else>
          <el-empty description="暂无签名" />
        </div>
      </div>
    </el-dialog>
    
    <!-- 签名编辑对话框 -->
    <el-dialog v-model="signatureEditShow" :title="editingSignature ? '编辑签名' : '添加签名'" width="500">
      <div class="signature-edit-form">
        <el-form :model="signatureForm" label-width="80px">
          <el-form-item label="签名名称">
            <el-input v-model="signatureForm.name" placeholder="请输入签名名称" />
          </el-form-item>
          <el-form-item label="签名内容">
            <el-input
              type="textarea"
              rows="6"
              v-model="signatureForm.content"
              placeholder="输入签名内容，支持HTML格式"
            />
          </el-form-item>
          <el-form-item>
            <el-checkbox v-model="signatureForm.isDefault">设为默认签名</el-checkbox>
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="signatureEditShow = false">取消</el-button>
          <el-button type="primary" @click="saveSignature">保存</el-button>
        </span>
      </template>
    </el-dialog>
    
    <!-- SMTP账户管理对话框 -->
    <el-dialog v-model="smtpAccountManagerShow" :title="$t('smtpAccountManager')" width="600">
      <div class="smtp-account-manager">
        <div class="smtp-account-header">
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
                <el-tag v-if="account.isDefault" size="small" type="success">默认</el-tag>
              </div>
              <div class="smtp-account-details">
                <div>{{ account.host }}:{{ account.port }}</div>
                <div>{{ account.user }}</div>
                <div>{{ account.secure === 1 ? 'SSL/TLS' : 'STARTTLS' }}</div>
              </div>
            </div>
            <div class="smtp-account-actions">
              <el-button size="small" @click="editSmtpAccount(account)">
                {{ $t('edit') }}
              </el-button>
              <el-button size="small" @click="setDefaultSmtpAccount(account)" v-if="!account.isDefault">
                {{ $t('setDefault') }}
              </el-button>
              <el-button size="small" type="danger" @click="deleteSmtpAccount(account)">
                {{ $t('delete') }}
              </el-button>
            </div>
          </div>
        </div>
        <div class="smtp-account-empty" v-else>
          <el-empty description="暂无SMTP账户" />
        </div>
      </div>
    </el-dialog>
    
    <!-- SMTP账户编辑对话框 -->
    <el-dialog v-model="smtpAccountEditShow" :title="editingSmtpAccount ? $t('editSmtpAccount') : $t('addSmtpAccount')" width="500">
      <div class="smtp-account-edit-form">
        <el-form :model="smtpAccountForm" label-width="100px">
          <el-form-item label="账户名称">
            <el-input v-model="smtpAccountForm.name" placeholder="请输入SMTP账户名称" />
          </el-form-item>
          <el-form-item label="SMTP主机">
            <el-input v-model="smtpAccountForm.host" placeholder="smtp.example.com" />
          </el-form-item>
          <el-form-item label="SMTP端口">
            <el-input-number v-model="smtpAccountForm.port" :min="1" :max="65535" />
          </el-form-item>
          <el-form-item label="用户名">
            <el-input v-model="smtpAccountForm.user" placeholder="user@example.com" />
          </el-form-item>
          <el-form-item label="密码">
            <el-input type="password" show-password v-model="smtpAccountForm.password" />
          </el-form-item>
          <el-form-item label="加密方式">
            <el-select v-model="smtpAccountForm.secure">
              <el-option :value="0" label="STARTTLS"/>
              <el-option :value="1" label="SSL/TLS"/>
            </el-select>
          </el-form-item>
          <el-form-item label="认证方式">
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
        <div class="smtp-verify-button" style="margin-top: 20px;">
          <el-button type="primary" :loading="smtpAccountVerifying" @click="verifySmtpAccountConfigLocal">
            {{ $t('test') }}
          </el-button>
        </div>
      </div>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="smtpAccountEditShow = false">取消</el-button>
          <el-button type="primary" @click="saveSmtpAccount">保存</el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>
<script setup>
import {reactive, ref, onMounted} from 'vue'
import {accountAdd, accountDelete, accountList as fetchAccountList} from "@/request/account.js"
import {useUserStore} from "@/store/user.js"
import {Icon} from "@iconify/vue"
import LoadingComponent from "@/components/loading/index.vue"
import {getSmtpAccountConfig, saveSmtpAccountConfig, verifySmtpAccountConfig, settingQuery, getSignatures, addSignature as addSignatureApi, updateSignature, deleteSignature as deleteSignatureApi, setDefaultSignature as setDefaultSignatureApi} from "@/request/setting.js"
import {useI18n} from 'vue-i18n'
import {ElMessage, ElMessageBox} from 'element-plus'
import {smtpAccountList, smtpAccountCreate, smtpAccountUpdate, smtpAccountDelete, smtpAccountVerify} from "@/request/smtp.js"

const { t } = useI18n()
const userStore = useUserStore()
const loading = ref(true)
const addAccountShow = ref(false)
const smtpConfigShow = ref(false)
const addLoading = ref(false)
const smtpVerifying = ref(false)
const currentAccount = ref(null)
const smtpConfigPermission = ref(true)

// 签名管理相关状态
const signatureManagerShow = ref(false)
const signatureEditShow = ref(false)
const signatures = ref([])
const editingSignature = ref(null)
const signatureForm = reactive({
  name: '',
  content: '',
  isDefault: false
})

// SMTP账户管理相关状态
const smtpAccountManagerShow = ref(false)
const smtpAccountEditShow = ref(false)
const smtpAccounts = ref([])
const editingSmtpAccount = ref(null)
const smtpAccountVerifying = ref(false)
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
    const [data, settingData] = await Promise.all([
      fetchAccountList(),
      settingQuery()
    ])
    accountList.value = data.map(item => ({
      ...item,
      createTime: new Date(item.createTime).toLocaleString()
    }))
    // 检查用户是否有SMTP配置权限
    smtpConfigPermission.value = settingData.smtpUserConfig === 1
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

// 签名管理相关方法
async function openSignatureManager() {
  if (!currentAccount.value) return
  
  try {
    const data = await getSignatures(currentAccount.value.accountId)
    signatures.value = data
  } catch (error) {
    console.error('获取签名列表失败:', error)
    ElMessage({
      message: '获取签名列表失败',
      type: 'error',
      plain: true
    })
  }
  
  signatureManagerShow.value = true
}

function addSignature() {
  editingSignature.value = null
  signatureForm.name = ''
  signatureForm.content = ''
  signatureForm.isDefault = false
  signatureEditShow.value = true
}

function editSignature(signature) {
  editingSignature.value = signature
  signatureForm.name = signature.name
  signatureForm.content = signature.content
  signatureForm.isDefault = signature.isDefault
  signatureEditShow.value = true
}

async function saveSignature() {
  if (!currentAccount.value) return
  
  if (!signatureForm.name) {
    ElMessage({
      message: '请输入签名名称',
      type: 'error',
      plain: true
    })
    return
  }
  
  try {
    if (editingSignature.value) {
      // 编辑签名
      await updateSignature(currentAccount.value.accountId, editingSignature.value.id, signatureForm)
      ElMessage({
        message: '签名更新成功',
        type: 'success',
        plain: true
      })
    } else {
      // 添加签名
      await addSignatureApi(currentAccount.value.accountId, signatureForm)
      ElMessage({
        message: '签名添加成功',
        type: 'success',
        plain: true
      })
    }
    
    // 重新加载签名列表
    const data = await getSignatures(currentAccount.value.accountId)
    signatures.value = data
    
    signatureEditShow.value = false
  } catch (error) {
    console.error('保存签名失败:', error)
    ElMessage({
      message: '保存签名失败',
      type: 'error',
      plain: true
    })
  }
}

async function deleteSignature(signature) {
  ElMessageBox.confirm('确定要删除这个签名吗？', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(async () => {
    if (!currentAccount.value) return
    
    try {
      await deleteSignatureApi(currentAccount.value.accountId, signature.id)
      ElMessage({
        message: '签名删除成功',
        type: 'success',
        plain: true
      })
      
      // 重新加载签名列表
      const data = await getSignatures(currentAccount.value.accountId)
      signatures.value = data
    } catch (error) {
      console.error('删除签名失败:', error)
      ElMessage({
        message: '删除签名失败',
        type: 'error',
        plain: true
      })
    }
  })
}

async function setDefaultSignature(signature) {
  if (!currentAccount.value) return
  
  try {
    await setDefaultSignatureApi(currentAccount.value.accountId, signature.id)
    ElMessage({
      message: '已设为默认签名',
      type: 'success',
      plain: true
    })
    
    // 重新加载签名列表
    const data = await getSignatures(currentAccount.value.accountId)
    signatures.value = data
  } catch (error) {
    console.error('设置默认签名失败:', error)
    ElMessage({
      message: '设置默认签名失败',
      type: 'error',
      plain: true
    })
  }
}

// SMTP账户管理相关方法
async function openSmtpAccountManager(account) {
  currentAccount.value = account
  smtpAccountManagerShow.value = true
  
  try {
    const data = await smtpAccountList(account.accountId)
    smtpAccounts.value = data
  } catch (error) {
    console.error('获取SMTP账户列表失败:', error)
    ElMessage({
      message: '获取SMTP账户列表失败',
      type: 'error',
      plain: true
    })
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
  smtpAccountEditShow.value = true
}

function editSmtpAccount(account) {
  editingSmtpAccount.value = account
  smtpAccountForm.name = account.name
  smtpAccountForm.host = account.host
  smtpAccountForm.port = account.port
  smtpAccountForm.user = account.user
  smtpAccountForm.password = '' // 不显示密码
  smtpAccountForm.secure = account.secure
  smtpAccountForm.authType = account.authType
  smtpAccountForm.isDefault = account.isDefault === 1
  smtpAccountEditShow.value = true
}

async function saveSmtpAccount() {
  if (!currentAccount.value) return
  
  if (!smtpAccountForm.name || !smtpAccountForm.host || !smtpAccountForm.user || !smtpAccountForm.password) {
    ElMessage({
      message: '请填写完整的SMTP账户信息',
      type: 'error',
      plain: true
    })
    return
  }
  
  try {
    const formData = {
      ...smtpAccountForm,
      accountId: currentAccount.value.accountId
    }
    
    if (editingSmtpAccount.value) {
      // 编辑SMTP账户
      await smtpAccountUpdate(editingSmtpAccount.value.smtpAccountId, formData)
      ElMessage({
        message: 'SMTP账户更新成功',
        type: 'success',
        plain: true
      })
    } else {
      // 添加SMTP账户
      await smtpAccountCreate(formData)
      ElMessage({
        message: 'SMTP账户添加成功',
        type: 'success',
        plain: true
      })
    }
    
    // 重新加载SMTP账户列表
    const data = await smtpAccountList(currentAccount.value.accountId)
    smtpAccounts.value = data
    
    smtpAccountEditShow.value = false
  } catch (error) {
    console.error('保存SMTP账户失败:', error)
    ElMessage({
      message: '保存SMTP账户失败',
      type: 'error',
      plain: true
    })
  }
}

async function deleteSmtpAccount(account) {
  ElMessageBox.confirm('确定要删除这个SMTP账户吗？', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(async () => {
    if (!currentAccount.value) return
    
    try {
      await smtpAccountDelete(account.smtpAccountId, currentAccount.value.accountId)
      ElMessage({
        message: 'SMTP账户删除成功',
        type: 'success',
        plain: true
      })
      
      // 重新加载SMTP账户列表
      const data = await smtpAccountList(currentAccount.value.accountId)
      smtpAccounts.value = data
    } catch (error) {
      console.error('删除SMTP账户失败:', error)
      ElMessage({
        message: '删除SMTP账户失败',
        type: 'error',
        plain: true
      })
    }
  })
}

async function setDefaultSmtpAccount(account) {
  if (!currentAccount.value) return
  
  try {
    // 设置为默认账户
    await smtpAccountUpdate(account.smtpAccountId, {
      ...account,
      accountId: currentAccount.value.accountId,
      isDefault: true
    })
    ElMessage({
      message: '已设为默认SMTP账户',
      type: 'success',
      plain: true
    })
    
    // 重新加载SMTP账户列表
    const data = await smtpAccountList(currentAccount.value.accountId)
    smtpAccounts.value = data
  } catch (error) {
    console.error('设置默认SMTP账户失败:', error)
    ElMessage({
      message: '设置默认SMTP账户失败',
      type: 'error',
      plain: true
    })
  }
}

async function verifySmtpAccountConfigLocal() {
  if (!currentAccount.value) return
  
  smtpAccountVerifying.value = true
  try {
    const result = await smtpAccountVerify(currentAccount.value.accountId, smtpAccountForm)
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
    smtpAccountVerifying.value = false
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
    .permission-tip {
      margin-bottom: 20px;
    }
    
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
  
  .signature-manager {
    .signature-header {
      margin-bottom: 10px;
    }
    
    .signature-list {
      .signature-item {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        padding: 15px;
        border: 1px solid var(--el-border-color);
        border-radius: 4px;
        margin-bottom: 10px;
        
        .signature-info {
          flex: 1;
          
          .signature-name {
            font-weight: bold;
            margin-bottom: 8px;
            display: flex;
            align-items: center;
            gap: 8px;
          }
          
          .signature-content {
            font-size: 14px;
            line-height: 1.5;
            color: var(--el-text-color-secondary);
          }
        }
        
        .signature-actions {
          display: flex;
          flex-direction: column;
          gap: 5px;
          margin-left: 15px;
        }
      }
    }
    
    .signature-empty {
      padding: 40px 0;
      text-align: center;
    }
  }
  
  .signature-edit-form {
    .el-form {
      max-width: 100%;
    }
  }
  
  .smtp-account-manager {
    .smtp-account-header {
      margin-bottom: 10px;
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
}
</style>