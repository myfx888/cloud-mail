<template>
  <div class="account-box">
    <div class="head-opt">
      <Icon v-perm="'account:add'" class="icon add" icon="ion:add-outline" width="23" height="23" @click="add"/>
      <Icon class="icon group-add" icon="ion:folder-open-outline" width="20" height="20" :title="$t('newGroup')" @click="openGroupDialog(null)"/>
      <Icon class="icon refresh" icon="ion:reload" width="18" height="18" @click="refresh"/>
    </div>
    <el-scrollbar class="scrollbar" ref="scrollbarRef">
      <div class="list-wrap" v-loading="loading">
        <!-- 主邮箱：固定第一，不可拖、不可删 -->
        <el-card v-if="view.main" class="item main-item" :class="itemBg(view.main.accountId)"
                 :key="'main-' + view.main.accountId" @click="cardClick(view.main)">
          <div class="account">{{ view.main.email }}</div>
          <div class="opt">
            <div class="send-email" @click.stop>
              <Icon @click="setAllReceive(view.main)" v-if="!view.main.allReceive" icon="eva:email-fill" width="22" height="22" color="#fccb1a"/>
              <Icon @click="setAllReceive(view.main)" v-else icon="flat-color-icons:folder" width="22" height="22" color="#23c4f1" />
            </div>
            <div class="settings" @click.stop>
              <Icon icon="mdi:signature-freehand" width="22" height="22" color="#67C23A" @click.stop="openSignatureManager(view.main)" style="cursor:pointer"/>
              <Icon icon="fluent-color:clipboard-24" width="22" height="22" @click.stop="copyAccount(view.main.email)"/>
              <Icon icon="fluent:settings-24-filled" width="21" height="21" color="#909399" v-if="showNullSetting()"/>
              <el-dropdown v-else>
                <Icon icon="fluent:settings-24-filled" width="21" height="21" color="#909399"/>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item v-if="hasPerm('email:send')" @click="openSetName(view.main)">{{ $t('rename') }}</el-dropdown-item>
                    <el-dropdown-item v-if="hasPerm('smtp:set')" @click="openSmtpManager(view.main)">{{ $t('smtpSetting') }}</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </div>
        </el-card>

        <!-- 自定义分组 -->
        <div class="group-list" ref="groupsRef">
          <div class="group" v-for="group in view.groups" :key="group.id">
            <div class="group-head">
              <Icon class="fold" :icon="group.collapsed ? 'mingcute:right-line' : 'mingcute:down-line'"
                    width="16" height="16" @click="toggleCollapse(group)"/>
              <span class="group-name" @click="toggleCollapse(group)">{{ group.name }}</span>
              <span class="group-opt" @click.stop>
                <Icon icon="fluent:edit-24-regular" width="14" height="14" @click.stop="openGroupDialog(group)"/>
                <Icon icon="fluent:delete-24-regular" width="14" height="14" @click.stop="removeGroup(group)"/>
              </span>
            </div>
            <div class="group-body account-drag-area" v-show="!group.collapsed" :data-group-id="group.id">
              <el-card v-for="item in group.accounts" :key="item.accountId"
                       class="item" :class="itemBg(item.accountId)"
                       :data-account-id="item.accountId"
                       @click="cardClick(item)">
                <div class="account">{{ item.email }}</div>
                <div class="opt">
                  <div class="send-email" @click.stop>
                    <Icon @click="setAllReceive(item)" v-if="!item.allReceive" icon="eva:email-fill" width="22" height="22" color="#fccb1a"/>
                    <Icon @click="setAllReceive(item)" v-else icon="flat-color-icons:folder" width="22" height="22" color="#23c4f1" />
                  </div>
                  <div class="settings" @click.stop>
                    <Icon icon="mdi:signature-freehand" width="22" height="22" color="#67C23A" @click.stop="openSignatureManager(item)" style="cursor:pointer"/>
                    <Icon icon="fluent-color:clipboard-24" width="22" height="22" @click.stop="copyAccount(item.email)"/>
                    <Icon icon="fluent:settings-24-filled" width="21" height="21" color="#909399" v-if="showNullSetting()"/>
                    <el-dropdown v-else>
                      <Icon icon="fluent:settings-24-filled" width="21" height="21" color="#909399"/>
                      <template #dropdown>
                        <el-dropdown-menu>
                          <el-dropdown-item v-if="hasPerm('email:send')" @click="openSetName(item)">{{ $t('rename') }}</el-dropdown-item>
                          <el-dropdown-item v-if="item.accountId !== userStore.user.account.accountId" @click="remove(item)">{{ $t('delete') }}</el-dropdown-item>
                          <el-dropdown-item v-if="hasPerm('smtp:set')" @click="openSmtpManager(item)">{{ $t('smtpSetting') }}</el-dropdown-item>
                        </el-dropdown-menu>
                      </template>
                    </el-dropdown>
                  </div>
                </div>
              </el-card>
            </div>
          </div>
        </div>

        <!-- 未分组 -->
        <template v-if="view.ungrouped.length > 0">
          <div class="group-head ungrouped-head">
            <span class="group-name">{{ $t('ungrouped') }}</span>
          </div>
          <div class="ungrouped-body account-drag-area" :data-group-id="0">
            <el-card v-for="item in view.ungrouped" :key="item.accountId"
                     class="item" :class="itemBg(item.accountId)"
                     :data-account-id="item.accountId"
                     @click="cardClick(item)">
              <div class="account">{{ item.email }}</div>
              <div class="opt">
                <div class="send-email" @click.stop>
                  <Icon @click="setAllReceive(item)" v-if="!item.allReceive" icon="eva:email-fill" width="22" height="22" color="#fccb1a"/>
                  <Icon @click="setAllReceive(item)" v-else icon="flat-color-icons:folder" width="22" height="22" color="#23c4f1" />
                </div>
                <div class="settings" @click.stop>
                  <Icon icon="mdi:signature-freehand" width="22" height="22" color="#67C23A" @click.stop="openSignatureManager(item)" style="cursor:pointer"/>
                  <Icon icon="fluent-color:clipboard-24" width="22" height="22" @click.stop="copyAccount(item.email)"/>
                  <Icon icon="fluent:settings-24-filled" width="21" height="21" color="#909399" v-if="showNullSetting()"/>
                  <el-dropdown v-else>
                    <Icon icon="fluent:settings-24-filled" width="21" height="21" color="#909399"/>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item v-if="hasPerm('email:send')" @click="openSetName(item)">{{ $t('rename') }}</el-dropdown-item>
                        <el-dropdown-item v-if="item.accountId !== userStore.user.account.accountId" @click="remove(item)">{{ $t('delete') }}</el-dropdown-item>
                        <el-dropdown-item v-if="hasPerm('smtp:set')" @click="openSmtpManager(item)">{{ $t('smtpSetting') }}</el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </div>
              </div>
            </el-card>
          </div>
        </template>

        <div class="empty" v-if="!loading && accounts.length === 0">
          <el-empty :description="$t('noMessagesFound')"/>
        </div>
      </div>
    </el-scrollbar>
    <el-dialog v-model="showAdd" :title="$t('addAccount')">
      <div class="container">
        <el-input v-model="addForm.email" ref="addRef" type="text" :placeholder="$t('emailAccount')" autocomplete="off">
          <template #append>
            <div @click.stop="openSelect">
              <el-select
                  ref="mySelect"
                  v-model="addForm.suffix"
                  :placeholder="$t('select')"
                  class="select"
              >
                <el-option
                    v-for="item in domainList"
                    :key="item"
                    :label="item"
                    :value="item"
                />
              </el-select>
              <div>
                <span>{{ addForm.suffix }}</span>
                <Icon class="setting-icon" icon="mingcute:down-small-fill" width="20" height="20"/>
              </div>
            </div>
          </template>
        </el-input>
        <el-button class="btn" type="primary" @click="submit" :loading="addLoading"
        >{{ $t('add') }}
        </el-button>
      </div>
      <div
          class="add-email-turnstile"
          :class="verifyShow ? 'turnstile-show' : 'turnstile-hide'"
          :data-sitekey="settingStore.settings.siteKey"
          data-callback="onTurnstileSuccess"
          data-error-callback="onTurnstileError"
      >
        <span style="font-size: 12px;color: #F56C6C" v-if="botJsError">{{ $t('verifyModuleFailed') }}</span>
      </div>
    </el-dialog>
    <el-dialog v-model="setNameShow" :title="$t('changeUserName')">
      <div class="container">
        <el-input v-model="accountName" type="text" :placeholder="$t('username')" autocomplete="off">
        </el-input>
        <el-button class="btn" type="primary" @click="setName" :loading="setNameLoading"
        >{{ $t('save') }}
        </el-button>
      </div>
    </el-dialog>
  </div>
  <signatureManager ref="signatureManagerRef" :account-id="signatureAccountId" @updated="onSignatureUpdated" />
  <smtpAccountManager ref="smtpAccountManagerRef" :account-id="smtpManagerAccountId" />
  <el-dialog v-model="groupDialogShow" :title="groupEditTarget ? $t('renameGroup') : $t('newGroup')" width="400px">
    <el-input v-model="groupNameInput" :placeholder="$t('groupName')" maxlength="30" autocomplete="off" @keyup.enter="saveGroupDialog"/>
    <template #footer>
      <el-button @click="groupDialogShow = false">{{ $t('cancel') }}</el-button>
      <el-button type="primary" @click="saveGroupDialog">{{ $t('confirm') }}</el-button>
    </template>
  </el-dialog>
</template>
<script setup>
import {Icon} from "@iconify/vue";
import signatureManager from "@/components/signature-manager/index.vue";
import smtpAccountManager from "@/components/smtp-account-manager/index.vue";
import {nextTick, reactive, ref, watch} from "vue";
import {
  accountList,
  accountGroups,
  accountSaveView,
  accountAdd,
  accountDelete,
  accountSetName,
  accountSetAllReceive
} from "@/request/account.js";
import Sortable from 'sortablejs';
import {sleep} from "@/utils/time-utils.js"
import {isEmail} from "@/utils/verify-utils.js";
import {useSettingStore} from "@/store/setting.js";
import {useAccountStore} from "@/store/account.js";
import {useEmailStore} from "@/store/email.js";
import {useUserStore} from "@/store/user.js";
import {hasPerm} from "@/perm/perm.js"
import {useI18n} from "vue-i18n";
import {AccountAllReceiveEnum} from "@/enums/account-enum.js";

const {t} = useI18n();
const userStore = useUserStore();
const accountStore = useAccountStore();
const settingStore = useSettingStore();
const emailStore = useEmailStore();
const showAdd = ref(false)
const addLoading = ref(false);
const domainList = settingStore.domainList
const accounts = ref([])
const groupsMeta = ref([])
const view = reactive({ main: null, groups: [], ungrouped: [] })
const groupsRef = ref(null)
const loading = ref(false)
const collapsedMap = reactive(JSON.parse(localStorage.getItem('account-group-collapsed') || '{}'))
const verifyShow = ref(false)
const setNameShow = ref(false)
const setNameLoading = ref(false)
const accountName = ref(null)
const addRef = ref({})
const scrollbarRef = ref({})
let account = null
let turnstileId = null
const botJsError = ref(false)
let verifyToken = ''
let verifyErrorCount = 0
const addForm = reactive({
  email: '',
  suffix: settingStore.domainList[0]
})

const mySelect = ref()
const signatureManagerRef = ref()
const signatureAccountId = ref(0)
const smtpAccountManagerRef = ref()
const smtpManagerAccountId = ref(0)

const isMobile = () => window.innerWidth < 768

// ===== 拖动与组管理状态 =====
let nextTempGroupId = -1
let accountSortables = []
let groupSortable = null
let justDragged = false
const groupDialogShow = ref(false)
const groupNameInput = ref('')
const groupEditTarget = ref(null)

if (hasPerm('account:query')) {
  loadAll()
}

watch(() => accountStore.accountListUpdated, () => {
  loadAll()
})

watch(() => accountStore.changeUserAccountName, () => {
  if (view.main) view.main.name = accountStore.changeUserAccountName
})


const openSelect = () => {
  mySelect.value.toggleMenu()
}

window.onTurnstileError = (e) => {
  if (verifyErrorCount >= 4) {
    return
  }
  verifyErrorCount++
  console.warn('人机验加载失败', e)
  setTimeout(() => {
    nextTick(() => {
      if (!turnstileId) {
        turnstileId = window.turnstile.render('.add-email-turnstile')
      } else {
        window.turnstile.reset(turnstileId);
      }
    })
  }, 1500)
};

window.onTurnstileSuccess = (token) => {
  verifyToken = token;
};

// ===== 全量加载与视图构建 =====
async function loadAll() {
  loading.value = true
  try {
    const [list, groups] = await Promise.all([accountList(), accountGroups()])
    accounts.value = list
    groupsMeta.value = groups
    buildView()
    accountStore.setAccounts([...accounts.value])
    if (!accountStore.currentAccountId && accounts.value.length > 0) {
      changeAccount(accounts.value[0])
    }
    await nextTick()
    initSortables()
  } finally {
    loading.value = false
  }
}

function buildView() {
  const mainId = userStore.user?.account?.accountId
  view.main = accounts.value.find(a => a.accountId === mainId) || null
  const rest = accounts.value.filter(a => a.accountId !== mainId)
  view.groups = groupsMeta.value.map(g => ({
    id: g.groupId,
    name: g.name,
    sort: g.sort,
    collapsed: !!collapsedMap[g.groupId],
    accounts: rest.filter(a => (a.viewGroup || 0) === g.groupId)
  }))
  const groupedIds = new Set(view.groups.flatMap(g => g.accounts.map(a => a.accountId)))
  view.ungrouped = rest.filter(a => !groupedIds.has(a.accountId))
}

function toggleCollapse(group) {
  group.collapsed = !group.collapsed
  if (group.id > 0) {
    collapsedMap[group.id] = group.collapsed
    localStorage.setItem('account-group-collapsed', JSON.stringify(collapsedMap))
  }
}

function cardClick(item) {
  if (justDragged) return
  changeAccount(item)
}

// ===== 视图保存（乐观更新 + 失败回滚） =====
function buildViewPayload() {
  return {
    groups: view.groups.map((g, idx) => ({ id: g.id, name: g.name, sort: view.groups.length - idx })),
    items: [
      ...view.groups.flatMap(g => g.accounts.map((a, idx) => ({ accountId: a.accountId, viewGroup: g.id, viewSort: g.accounts.length - idx }))),
      ...view.ungrouped.map((a, idx) => ({ accountId: a.accountId, viewGroup: 0, viewSort: view.ungrouped.length - idx }))
    ]
  }
}

function snapshotView() {
  return JSON.stringify({ groups: view.groups, ungrouped: view.ungrouped })
}

function restoreView(snapshot) {
  const s = JSON.parse(snapshot)
  view.groups = s.groups
  view.ungrouped = s.ungrouped
}

function syncGroupIds(serverGroups) {
  // 后端按提交顺序返回（sort DESC == 提交时数组顺序），按下标回填真实 id
  view.groups.forEach((g, idx) => {
    const sg = serverGroups[idx]
    if (!sg) return
    if (sg.groupId !== g.id) {
      if (collapsedMap[g.id] !== undefined) {
        collapsedMap[sg.groupId] = collapsedMap[g.id]
        delete collapsedMap[g.id]
      }
      g.id = sg.groupId
    }
    g.sort = sg.sort
  })
  localStorage.setItem('account-group-collapsed', JSON.stringify(collapsedMap))
}

async function persistView() {
  const snapshot = snapshotView()
  try {
    const serverGroups = await accountSaveView(buildViewPayload())
    syncGroupIds(serverGroups || [])
  } catch (e) {
    restoreView(snapshot)
    ElMessage({ message: t('saveViewFailMsg'), type: 'error', plain: true })
  } finally {
    nextTick(initSortables)
  }
}

// ===== 组管理 =====
function openGroupDialog(group) {
  groupEditTarget.value = group
  groupNameInput.value = group ? group.name : ''
  groupDialogShow.value = true
}

async function saveGroupDialog() {
  const name = groupNameInput.value.trim()
  if (!name) return
  if (groupEditTarget.value) {
    groupEditTarget.value.name = name
  } else {
    view.groups.push({ id: nextTempGroupId--, name, sort: 0, collapsed: false, accounts: [] })
  }
  groupDialogShow.value = false
  await persistView()
}

function removeGroup(group) {
  ElMessageBox.confirm(t('deleteGroupConfirm'), {
    confirmButtonText: t('confirm'),
    cancelButtonText: t('cancel'),
    type: 'warning'
  }).then(async () => {
    view.ungrouped.push(...group.accounts)
    view.groups.splice(view.groups.indexOf(group), 1)
    await persistView()
  })
}

// ===== 拖动（sortablejs 多容器） =====
function destroySortables() {
  accountSortables.forEach(s => s.destroy())
  accountSortables = []
  if (groupSortable) {
    groupSortable.destroy()
    groupSortable = null
  }
}

function initSortables() {
  destroySortables()
  if (groupsRef.value) {
    groupSortable = new Sortable(groupsRef.value, {
      group: 'groups', handle: '.group-head', animation: 150,
      onEnd: onGroupDrop
    })
  }
  document.querySelectorAll('.account-drag-area').forEach(el => {
    accountSortables.push(new Sortable(el, {
      group: 'accounts', animation: 150,
      delay: isMobile() ? 200 : 0, delayOnTouchOnly: true,
      onEnd: onAccountDrop
    }))
  })
}

// sortable 已物理移动 DOM，先还原再改响应式数据，避免与 Vue patch 冲突
function revertDom(evt) {
  const { item, from, oldIndex } = evt
  if (from.children[oldIndex] === item) return
  from.insertBefore(item, from.children[oldIndex] || null)
}

function listByGroupId(groupId) {
  if (Number(groupId) === 0) return view.ungrouped
  return view.groups.find(g => g.id === Number(groupId))?.accounts
}

function onAccountDrop(evt) {
  revertDom(evt)
  justDragged = true
  setTimeout(() => { justDragged = false }, 300)
  const { from, to, oldIndex, newIndex } = evt
  const accountId = Number(evt.item.dataset.accountId)
  const fromList = listByGroupId(from.dataset.groupId)
  const toList = listByGroupId(to.dataset.groupId)
  if (!fromList || !toList) return
  const [acc] = fromList.splice(fromList.findIndex(a => a.accountId === accountId), 1)
  toList.splice(newIndex, 0, acc)
  persistView()
}

function onGroupDrop(evt) {
  revertDom(evt)
  justDragged = true
  setTimeout(() => { justDragged = false }, 300)
  const { oldIndex, newIndex } = evt
  if (oldIndex === newIndex) return
  const [g] = view.groups.splice(oldIndex, 1)
  view.groups.splice(newIndex, 0, g)
  persistView()
}

function setName() {

  let name = accountName.value

  if (name === account.name) {
    setNameShow.value = false
    return
  }

  if (!name) {
    ElMessage({
      message: t('emptyUserNameMsg'),
      type: 'error',
      plain: true,
    })
    return;
  }

  setNameLoading.value = true
  accountSetName(account.accountId, name).then(() => {
    account.name = name
    setNameShow.value = false

    if (account.accountId === userStore.user.account.accountId) {
      userStore.user.name = name
    }

    ElMessage({
      message: t('saveSuccessMsg'),
      type: "success",
      plain: true
    })
  }).finally(() => {
    setNameLoading.value = false
  })
}

function openSetName(accountItem) {
  accountName.value = accountItem.name
  account = accountItem
  setNameShow.value = true
}

function setAllReceive(account) {
  let allReceiveAccount = accounts.value.find(item => item.allReceive === AccountAllReceiveEnum.ENABLED);
  if (allReceiveAccount && allReceiveAccount.accountId !== account.accountId) allReceiveAccount.allReceive = AccountAllReceiveEnum.DISABLED;
  account.allReceive = account.allReceive === AccountAllReceiveEnum.DISABLED ? AccountAllReceiveEnum.ENABLED : AccountAllReceiveEnum.DISABLED;
  accountSetAllReceive(account.accountId).catch(() => {
    account.allReceive = account.allReceive === AccountAllReceiveEnum.DISABLED ? AccountAllReceiveEnum.ENABLED : AccountAllReceiveEnum.DISABLED;
    if (allReceiveAccount) allReceiveAccount.allReceive = AccountAllReceiveEnum.ENABLED;
  }).then(() => {
    if (account.allReceive === AccountAllReceiveEnum.ENABLED) {
      ElMessage({
        message: t('setSuccess'),
        type: 'success',
        plain: true,
      })
    }
    changeAccount(account);
    emailStore.emailScroll?.refreshList();
    emailStore.sendScroll?.refreshList();
  })
}


function showNullSetting() {
  return !hasPerm('email:send') && !hasPerm('smtp:set')
}

function itemBg(accountId) {
  return accountStore.currentAccountId === accountId ? 'item-choose' : ''
}


function remove(accountItem) {
  ElMessageBox.confirm(t('removeAccountConfirm', {msg: accountItem.email}), {
    confirmButtonText: t('confirm'),
    cancelButtonText: t('cancel'),
    type: 'warning'
  }).then(async () => {
    await accountDelete(accountItem.accountId)
    ElMessage({
      message: t('delSuccessMsg'),
      type: 'success',
      plain: true,
    })
    await loadAll()
  });
}

function refresh() {
  loadAll()
}

function changeAccount(accountItem) {
  accountStore.currentAccountId = accountItem.accountId
  accountStore.currentAccount = accountItem
}

function add() {
  showAdd.value = true
  setTimeout(() => {
    addRef.value.focus()
  }, 100)
}

function openSignatureManager(item) {
  signatureAccountId.value = item.accountId
  nextTick(() => {
    signatureManagerRef.value.open()
  })
}

function onSignatureUpdated() {
  // signatures updated, no action needed in account list
}

function openSmtpManager(item) {
  smtpManagerAccountId.value = item.accountId
  nextTick(() => {
    smtpAccountManagerRef.value.open()
  })
}

async function copyAccount(email) {
  try {
    await navigator.clipboard.writeText(email);
    ElMessage({
      message: t('copySuccessMsg'),
      type: 'success',
      plain: true,
    })
  } catch (err) {
    console.error(`${t('copyFailMsg')}:`, err);
    ElMessage({
      message: t('copyFailMsg'),
      type: 'error',
      plain: true,
    })
  }
}

async function submit() {

  if (!addForm.email) {
    ElMessage({
      message: t('emptyEmailMsg'),
      type: "error",
      plain: true
    })
    return
  }

  if (addForm.email.length < settingStore.settings.minEmailPrefix) {
    ElMessage({
      message: t('minEmailPrefix', {msg: settingStore.settings.minEmailPrefix}),
      type: 'error',
      plain: true,
    })
    return
  }

  if (!isEmail(addForm.email + addForm.suffix)) {
    ElMessage({
      message: t('notEmailMsg'),
      type: "error",
      plain: true
    })
    return
  }

  if (!verifyToken && (settingStore.settings.addEmailVerify === 0 || (settingStore.settings.addEmailVerify === 2 && settingStore.settings.addVerifyOpen))) {
    if (!verifyShow.value) {
      verifyShow.value = true
      nextTick(() => {
        if (!turnstileId) {
          try {
            turnstileId = window.turnstile.render('.add-email-turnstile')
          } catch (e) {
            botJsError.value = true
            console.log('人机验证js加载失败')
          }
        } else {
          window.turnstile.reset('.add-email-turnstile')
        }
      })
    } else if (!botJsError.value) {
      ElMessage({
        message: t('botVerifyMsg'),
        type: "error",
        plain: true
      })
    }
    return;
  }

  addLoading.value = true
  accountAdd(addForm.email + addForm.suffix, verifyToken).then(accountRow => {
    addLoading.value = false
    showAdd.value = false
    addForm.email = ''
    accounts.value.push(accountRow)
    buildView()
    accountStore.setAccounts([...accounts.value])
    verifyToken = ''
    settingStore.settings.addVerifyOpen = accountRow.addVerifyOpen
    ElMessage({
      message: t('addSuccessMsg'),
      type: "success",
      plain: true
    })
    verifyShow.value = false
    userStore.refreshUserInfo()
  }).catch(res => {
    if (res.code === 400) {
      verifyToken = ''
      if (turnstileId) {
        window.turnstile.reset(turnstileId)
      } else {
        nextTick(() => {
          turnstileId = window.turnstile.render('.add-email-turnstile')
        })
      }
      verifyShow.value = true
    }
    addLoading.value = false
  })
}
</script>
<style>
path[fill="#ffdda1"] {
  fill: #ffdd7d;
}
</style>
<style scoped lang="scss">
.account-box {

  border-right: 1px solid var(--el-border-color) !important;
  background-color: var(--el-bg-color);
  height: 100%;
  overflow: hidden;

  .head-opt {
    display: flex;
    align-items: center;
    height: 38px;
    box-shadow: var(--header-actions-border);
    padding-left: 10px;
    padding-right: 10px;

    .icon {
      cursor: pointer;
    }

    .refresh {
      margin-left: 10px;
    }

    .group-add {
      margin-left: 8px;
    }

    .add {
      margin-left: 2px;
    }

    .head-opt:not(.add) .refresh {
      margin-left: 5px;
    }
  }

  .scrollbar {
    width: 100%;
    height: calc(100% - 38px);
    overflow: auto;
    @media (max-width: 767px) {
      height: calc(100% - 154px);
    }

    .empty {
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100%;
    }
  }

  .btn {
    width: 100%;
    margin-top: 15px;
  }

  .group-list {
    margin-top: 4px;
  }

  .group {
    margin-top: 2px;
  }

  .group-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    cursor: pointer;
    user-select: none;

    .group-name {
      font-weight: 600;
      font-size: 13px;
      color: var(--secondary-text-color);
    }

    .fold {
      flex-shrink: 0;
    }

    .group-opt {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 8px;
      opacity: 0;
      transition: opacity 0.15s;

      svg {
        cursor: pointer;
        color: var(--secondary-text-color);
      }
    }

    &:hover .group-opt {
      opacity: 1;
    }
  }

  .ungrouped-head {
    margin-top: 6px;
    cursor: default;
  }

  .main-item {
    border: 1px solid var(--el-color-primary-light-5);
  }

  .item {
    background-color: var(--el-bg-color);
    border-radius: 8px;
    padding: 12px 10px;
    margin-bottom: 10px;
    margin-left: 10px;
    margin-right: 10px;
    cursor: pointer;

    .account {
      font-weight: 600;
      margin-bottom: 20px;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    .opt {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: #888;

      .settings {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .send-email {
        display: flex;
        align-items: center;
      }
    }

    :deep(.el-card__body) {
      padding: 0;
    }
  }

  .item:first-child {
    margin-top: 10px;
  }

  .item-choose {
    background: var(--choose-account-background);
  }
}


.setting-icon {
  position: relative;
  top: 6px;
}

:deep(.el-input-group__append) {
  padding: 0 !important;
  padding-left: 8px !important;
  background: var(--el-bg-color);
}

:deep(.el-dialog) {
  width: 400px !important;
  @media (max-width: 440px) {
    width: calc(100% - 40px) !important;
    margin-right: 20px !important;
    margin-left: 20px !important;
  }
}

.select {
  position: absolute;
  right: 30px;
  width: 100px;
  opacity: 0;
  pointer-events: none;
}

:deep(.el-pagination .el-select) {
  width: 100px;
  background: var(--el-bg-color);
}

.add-email-turnstile {
  margin-top: 15px;
}

.turnstile-show {
  opacity: 1;
}

.turnstile-hide {
  opacity: 0;
  pointer-events: none;
  position: fixed;
}

</style>
