<template>
  <div class="send" v-show="show">
    <div class="write-box">
      <div class="title">
          <div class="title-left">
            <span class="title-text">
              <Icon icon="hugeicons:quill-write-01" width="28" height="28"/>
            </span>
            <span class="sender">{{ $t('sender') }}:</span>
            <span class="sender-name">{{ form.name }}</span>
            <span class="send-email"><{{ form.sendEmail }}></span>
          </div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <div class="lang-switch" @click="changeLang(settingStore.lang === 'en' ? 'zh' : 'en')">
              {{ settingStore.lang === 'en' ? '中' : 'EN' }}
            </div>
            <div @click="close" style="cursor: pointer;">
              <Icon icon="material-symbols-light:close-rounded" width="22" height="22"/>
            </div>
          </div>
        </div>
      <div class="container">
        <el-input-tag  @add-tag="addTagChange" tag-type="primary" @input="inputChange" size="default" v-model="form.receiveEmail" >
          <template #prefix>
            <div class="item-title" >{{ $t('recipient') }}</div>
            <el-select
                ref="mySelect"
                class="write-select"
                popper-class="write-select"
                :show-arrow="false"
                :no-match-text="' '"
                :no-data-text="' '"
                @visible-change="selectStatusChange"
                @change="selectChange"
            >
              <el-option
                  v-for="item in selectRecipientList"
                  :key="item"
                  :label="item"
                  :value="item"
                  style="color: #999896;"
              />
            </el-select>
          </template>
          <template #suffix>
            <div style="display: flex;margin-right: 3px;">
              <Icon icon="fa7-solid:user-plus" width="20" height="20" class="add-contact" @click.stop="openContacts" />
            </div>
          </template>
        </el-input-tag>
        <el-input v-model="form.subject" :placeholder="t('subject')" />
        <tinyEditor :def-value="defValue" ref="editor" @change="change" @focus="focusChange" />
        <div class="button-item">
          <div class="att-add" @click="chooseFile">
            <Icon icon="iconamoon:attachment-fill" width="24" height="24"/>
          </div>
          <div class="att-clear" @click="clearContent">
            <Icon icon="icon-park-outline:clear-format" width="24" height="24 "/>
          </div>
          <div class="att-list">
            <div class="att-item" v-for="(item,index) in form.attachments" :key="index">
              <Icon v-bind="getIconByName(item.filename)"/>
              <span class="att-filename">{{ item.filename }}</span>
              <span class="att-size">{{ formatBytes(item.size) }}</span>
              <Icon style="cursor: pointer;" icon="material-symbols-light:close-rounded" @click="delAtt(index)"
                    width="22" height="22"/>
            </div>
          </div>
          <div class="send-actions">
              <el-select
                  class="signature-select"
                  v-model="selectedSignatureId"
                  @change="handleSignatureChange"
                  size="small"
                  :placeholder="$t('selectSignature')"
                  clearable
                  v-if="signatures.length > 0"
              >
                <el-option v-for="signature in signatures" :key="signature.id" :label="signature.isDefault ? signature.name + ' ★' : signature.name" :value="signature.id"/>
              </el-select>
              <el-radio-group v-model="form.sendMethod" size="small" v-if="sendEmailAvailable || resendEnabled">
                <el-radio-button value="cloudflare" v-if="sendEmailAvailable">Cloudflare</el-radio-button>
                <el-radio-button value="resend" v-if="resendEnabled">Resend</el-radio-button>
                <el-radio-button value="smtp">SMTP</el-radio-button>
              </el-radio-group>
              <el-select
                  class="smtp-account-select"
                  v-model="selectedSmtpAccountId"
                  @change="handleSmtpAccountChange"
                  size="small"
                  placeholder="选择SMTP账户"
                  v-if="showSmtpSelector"
              >
                <el-option v-for="account in smtpAccounts" :key="account.smtpAccountId" :label="account.name" :value="account.smtpAccountId"/>
              </el-select>
              <el-button type="primary" @click="sendEmail" v-if="form.sendType === 'reply'">{{ $t('reply') }}</el-button>
              <el-button type="primary" @click="sendEmail" v-else-if="form.sendType === 'forward'">{{ $t('forward') }}</el-button>
              <el-button type="primary" @click="sendEmail" v-else>{{ $t('send') }}</el-button>
            </div>
        </div>
      </div>
    </div>
    <el-dialog top="10vh" v-model="showContacts" @closed="clearSelectContact" :title="t('recentContacts')">
      <el-table ref="contactsTabRef" row-key="email" :data="contacts" style="height: 445px">
        <el-table-column type="selection" width="32" />
        <el-table-column property="email" :label="t('emailAccount')" >
          <template #default="props">
            <div class="email-row">{{ props.row.email }}</div>
          </template>
        </el-table-column>
        <el-table-column width="55" label="" >
          <template #default>
            <div style="display: flex;">
              <Icon icon="mage:user" style="color: var(--el-text-color-primary)" width="22" height="22" color="#606266" />
            </div>
          </template>
        </el-table-column>
      </el-table>
      <div class="contacts-bottom">
        <el-button type="default" @click="deleteContact">{{t('clear')}}</el-button>
        <el-button type="primary" @click="chooseContact">{{t('selectContacts')}}</el-button>
      </div>
    </el-dialog>
  </div>
</template>
<script setup>
import tinyEditor from '@/components/tiny-editor/index.vue'
import {h, nextTick, onMounted, onUnmounted, reactive, ref, toRaw, computed, watch} from "vue";
import {Icon} from "@iconify/vue";
import {useUserStore} from "@/store/user.js";
import {emailSend} from "@/request/email.js";
import {getSmtpAccountConfig, getSignatures} from "@/request/setting.js";
import {smtpAccountList} from "@/request/smtp.js";
import {isEmail} from "@/utils/verify-utils.js";
import {useAccountStore} from "@/store/account.js";
import {useEmailStore} from "@/store/email.js";
import {fileToBase64, formatBytes} from "@/utils/file-utils.js";
import {getIconByName} from "@/utils/icon-utils.js";
import sendPercent from "@/components/send-percent/index.vue"
import {toOssDomain} from "@/utils/convert.js";
import {formatDetailDateEn, setExtend} from "@/utils/day.js";
import {useSettingStore} from "@/store/setting.js";
import {userDraftStore} from "@/store/draft.js";
import {useWriterStore} from "@/store/writer.js";
import db from "@/db/db.js";
import dayjs from "dayjs";
import {useI18n} from "vue-i18n";
import router from "@/router/index.js";
import {ElMessageBox} from "element-plus";

defineExpose({
  open,
  openReply,
  openForward,
  openDraft
})

const {t} = useI18n()
const writerStore = useWriterStore();
const draftStore = userDraftStore()
const settingStore = useSettingStore()
const emailStore = useEmailStore();
const accountStore = useAccountStore()
const editor = ref({})
const userStore = useUserStore();
const show = ref(false);
const percent = ref(0)
let percentMessage = null
let sending = false
const defValue = ref('')
const contactsTabRef = ref({})
const showContacts = ref(false)
const mySelect = ref()
let selectStatus = false

// 签名相关状态
const signatures = ref([])
const selectedSignatureId = ref('')

// SMTP账户相关状态
const smtpAccounts = ref([])
const selectedSmtpAccountId = ref('')

const backReply = reactive({
  receiveEmail: [],
  subject: '',
  content: '',
  sendType: ''
})
const form = reactive({
  sendEmail: '',
  receiveEmail: [],
  accountId: -1,
  name: '',
  subject: '',
  content: '',
  sendType: '',
  text: '',
  emailId: 0,
  attachments: [],
  draftId: null,
  sendMethod: 'resend',
  smtpAccountId: null,
})

const selectRecipientList = ref([])

const contacts = computed(() => writerStore.sendRecipientRecord.map(item => ({email: item})))
const resendEnabled = computed(() => Number(settingStore.settings?.resendEnabled ?? 1) === 1)
const sendEmailAvailable = computed(() => !!settingStore.settings?.sendEmailAvailable)
const showSmtpSelector = computed(() => {
  if (form.sendType === 'reply') {
    return smtpAccounts.value.length > 0
  }
  if (!resendEnabled.value && !sendEmailAvailable.value) {
    return smtpAccounts.value.length > 0
  }
  return form.sendMethod === 'smtp' && smtpAccounts.value.length > 0
})

watch(resendEnabled, (enabled) => {
  if (!enabled && !sendEmailAvailable.value) {
    form.sendMethod = 'smtp'
  }
})

function normalizeReplySubject(subject) {
  const rawSubject = (subject || '').trim()
  if (!rawSubject) {
    return 'Re: '
  }
  if (/^(re\s*[:：]|回复\s*[:：])/i.test(rawSubject)) {
    return rawSubject.replace(/^(re|回复)\s*[:：]\s*/i, 'Re: ')
  }
  return `Re: ${rawSubject}`
}

function normalizeForwardSubject(subject) {
  const rawSubject = (subject || '').trim()
  if (!rawSubject) {
    return 'Fwd: '
  }
  if (/^(fwd\s*[:：]|fw\s*[:：]|转发\s*[:：])/i.test(rawSubject)) {
    return rawSubject.replace(/^(fwd|fw|转发)\s*[:：]\s*/i, 'Fwd: ')
  }
  return `Fwd: ${rawSubject}`
}

function escapeHtml(value) {
  return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
}

function getRecipientText(email) {
  if (Array.isArray(email?.recipient)) {
    return email.recipient.map(item => item?.address || '').filter(Boolean).join(', ')
  }

  if (typeof email?.recipient === 'string') {
    try {
      const recipientArr = JSON.parse(email.recipient)
      if (Array.isArray(recipientArr)) {
        return recipientArr.map(item => item?.address || '').filter(Boolean).join(', ')
      }
    } catch (e) {
      return email.recipient
    }
  }

  return ''
}

function openContacts() {
  showContacts.value = true
  nextTick(() => {
    form.receiveEmail.forEach(item => {
      if (writerStore.sendRecipientRecord.includes(item)) {
        contactsTabRef.value.toggleRowSelection({email: item});
      }
    })
  })
}

function deleteContact() {
  ElMessageBox.confirm(t('confirmDeletionOfContacts'), {
    confirmButtonText: t('confirm'),
    cancelButtonText: t('cancel'),
    type: 'warning'
  }).then(() => {
    const contactList = contactsTabRef.value.getSelectionRows().map(item => item.email);
    form.receiveEmail = form.receiveEmail.filter(item => !contactList.includes(item));
    writerStore.sendRecipientRecord = writerStore.sendRecipientRecord.filter(item => !contactList.includes(item));
  })
}

function chooseContact() {

  const contactList = contactsTabRef.value.getSelectionRows().map(item => item.email);
  contactList.forEach(item => {
    if (!form.receiveEmail.includes(item)) {
      form.receiveEmail.push(item);
    }
  })

  form.receiveEmail = form.receiveEmail.filter(item => {
    return contactList.includes(item) || !writerStore.sendRecipientRecord.includes(item);
  });

  showContacts.value = false
}

function clearSelectContact() {
  contactsTabRef.value.clearSelection();
}

function selectChange(value) {
  form.receiveEmail.push(value)
}

function selectStatusChange(status) {
  selectStatus = status
}

const openSelect = () => {
  mySelect.value.toggleMenu()
}

function inputChange(value) {

  selectRecipientList.value = writerStore.sendRecipientRecord.filter(item => value && !form.receiveEmail.includes(item) && item.startsWith(value)).slice(0, 10);

  if (!selectStatus && selectRecipientList.value.length > 0) {
    openSelect()
  }

  if (selectStatus && selectRecipientList.value.length === 0) {
    openSelect()
  }

}

function addTagChange(val) {

  const emails = Array.from(new Set(
      val.split(/[,，]/).map(item => item.trim()).filter(item => item)
  ));

  form.receiveEmail.splice(form.receiveEmail.length - 1, 1)

  let has = false
  emails.forEach(email => {
    if (isEmail(email) && !form.receiveEmail.includes(email)) {
      form.receiveEmail.push(email)
      has = true
    }
  })
  if (selectStatus && has) openSelect()
}

function clearContent() {
  ElMessageBox.confirm(t('clearContentConfirm'), {
    confirmButtonText: t('confirm'),
    cancelButtonText: t('cancel'),
    type: 'warning'
  }).then(() => {
    resetForm()
  })

}

function delAtt(index) {
  form.attachments.splice(index, 1);
}

function chooseFile() {
  const doc = document.createElement("input")
  doc.setAttribute("type", "file")
  doc.multiple = true;
  doc.click()
  doc.onchange = async (e) => {

    const fileList = e.target.files;

    for (const file of fileList) {

      const size = file.size
      const filename = file.name
      const contentType = file.type

      const content = await fileToBase64(file)
      form.attachments.push({content, filename, size, contentType})

    }

  }
}

async function sendEmail() {

  if (form.receiveEmail.length === 0) {
    ElMessage({
      message: t('emptyRecipientMsg'),
      type: 'error',
      plain: true,
    })
    return
  }

  if (!form.subject) {
    ElMessage({
      message: t('emptySubjectMsg'),
      type: 'error',
      plain: true,
    })
    return
  }

  if (!form.content) {
    form.content = editor.value.getContent();
  }

  if (!form.content) {
    ElMessage({
      message: t('emptyContentMsg'),
      type: 'error',
      plain: true,
    })
    return
  }

  if (form.manyType === 'divide' && form.attachments.length > 0) {
    ElMessage({
      message: t('noSeparateSendMsg'),
      type: 'error',
      plain: true,
    })
    return
  }

  if (sending) {
    ElMessage({
      message: t('sendingErrorMsg'),
      type: 'error',
      plain: true,
    })
    return
  }

  percentMessage = ElMessage({
    message: () => h(sendPercent, {value: percent.value, desc: t('sending')}),
    dangerouslyUseHTMLString: true,
    plain: true,
    duration: 0,
    customClass: 'message-bottom'
  })

  sending = true

  show.value = false

  emailSend(form, (e) => {
    percent.value = Math.round((e.loaded * 98) / e.total)
  }).then(emailList => {
    const email = emailList[0]
    emailList.forEach(item => {
      emailStore.sendScroll?.addItem(item)
    })

    ElNotification({
      title: t('sendSuccessMsg'),
      type: "success",
      message: h('span', {style: 'color: teal'}, email.subject),
      position: 'bottom-right'
    })

    userStore.refreshUserInfo();

    addRecipientRecord();

    if (form.draftId) {
      form.subject = ''
      form.content = ''
      form.receiveEmail = []
      draftStore.setDraft = {...toRaw(form)}
    }

    show.value = false
    resetForm();
  }).catch((e) => {
    ElNotification({
      title: t('sendFailMsg'),
      type: e.code === 403 ? 'warning' : 'error',
      message: h('span', {style: 'color: teal'}, e.message),
      position: 'bottom-right'
    })
    if (e.code === 401) {
      localStorage.removeItem('token');
      router.replace('/login');
    }
    show.value = true
    addRecipientRecord();

    // 发送失败询问用户是否切换方式重试
    const availableMethods = []
    if (sendEmailAvailable.value && form.sendMethod !== 'cloudflare') availableMethods.push('cloudflare')
    if (resendEnabled.value && form.sendMethod !== 'resend') availableMethods.push('resend')
    if (form.sendMethod !== 'smtp') availableMethods.push('smtp')

    if (availableMethods.length > 0 && e.code !== 401) {
      ElMessageBox.confirm(
        t('sendFailRetryMsg', { msg: e?.message || t('sendFailMsg') }),
        t('sendFailRetryTitle'),
        {
          confirmButtonText: t('switchMethodRetry'),
          cancelButtonText: t('cancel'),
          type: 'warning'
        }
      ).then(() => {
        form.sendMethod = availableMethods[0]
      }).catch(() => {})
    }
  }).finally(() => {
    percentMessage.close()
    percent.value = 0
    sending = false
  })
}

function addRecipientRecord() {
  writerStore.sendRecipientRecord = writerStore.sendRecipientRecord.filter(
      email => !form.receiveEmail.includes(email)
  );

  writerStore.sendRecipientRecord.unshift(...form.receiveEmail);
  writerStore.sendRecipientRecord = writerStore.sendRecipientRecord.slice(0, 500);
}

function resetForm() {
  form.receiveEmail = []
  form.subject = ''
  form.content = ''
  form.manyType = null
  form.attachments = []
  form.sendType = ''
  form.emailId = 0
  form.draftId = null
  form.sendMethod = sendEmailAvailable.value ? 'cloudflare' : (resendEnabled.value ? 'resend' : 'smtp')
  form.smtpAccountId = null
  selectedSmtpAccountId.value = ''
  backReply.content = ''
  backReply.subject = ''
  backReply.receiveEmail = []
  backReply.sendType = ''
  editor.value.clearEditor()
}

function change(content, text) {
  form.content = content;
  form.text = text
}

function focusChange() {
  if (selectStatus) openSelect()
}

function openForward(email) {
  resetForm();

  email.subject = email.subject || ''

  form.subject = normalizeForwardSubject(email.subject)
  form.sendType = 'forward'
  form.sendMethod = sendEmailAvailable.value ? 'cloudflare' : (resendEnabled.value ? 'resend' : 'smtp')

  const fromName = escapeHtml(email.name || '')
  const fromEmail = escapeHtml(email.sendEmail || '')
  const subject = escapeHtml(email.subject || '')
  const toLine = escapeHtml(getRecipientText(email))
  const replyDate = formatDetailDateEn(email.createTime)

  defValue.value = ''

  setTimeout(async () => {
    defValue.value = `
      <div><br></div>
      <div>---------- Forwarded message ---------</div>
      <div><b>From:</b> ${fromName} &lt;${fromEmail}&gt;</div>
      <div><b>Date:</b> ${replyDate}</div>
      <div><b>Subject:</b> ${subject}</div>
      <div><b>To:</b> ${toLine}</div>
      <br>
      ${formatImage(email.content) || `<pre style="font-family: inherit;word-break: break-word;white-space: pre-wrap;margin: 0">${email.text}</pre>`}
    `
    await open()

    nextTick(() => {
      backReply.content = editor.value.getContent()
      backReply.subject = form.subject
      backReply.receiveEmail = form.receiveEmail
      backReply.sendType = form.sendType
    })

  });
}

function openReply(email) {

  resetForm();

  email.subject = email.subject || ''

  form.receiveEmail.push(email.sendEmail)
  form.subject = normalizeReplySubject(email.subject)
  form.sendType = 'reply'
  form.sendMethod = 'smtp'
  form.emailId = email.emailId

  defValue.value = ''

  setTimeout(async () => {
    defValue.value = `
    <div></div>
    <div>
    <br>
        ${formatDetailDateEn(email.createTime)} ${email.name} &lt${email.sendEmail}&gt wrote:
    </div>
    <blockquote class="mceNonEditable" style="margin: 0 0 0 0.8ex;border-left: 1px solid rgb(204,204,204);padding-left: 1ex;">
      <articl>
          ${formatImage(email.content) || `<pre style="font-family: inherit;word-break: break-word;white-space: pre-wrap;margin: 0">${email.text}</pre>`}
      </article>
    </blockquote>`
    await open()

    nextTick(() => {
      backReply.content = editor.value.getContent()
      backReply.subject = form.subject
      backReply.receiveEmail = form.receiveEmail
      backReply.sendType = form.sendType
    })
  })

}

function formatImage(content) {
  content = content || '';
  const domain = settingStore.settings.r2Domain;
  return content.replace(/{{domain}}/g, toOssDomain(domain) + '/');
}

async function open() {
  if (!accountStore.currentAccount.email) {
    form.sendEmail = userStore.user.email;
    form.accountId = userStore.user.account.accountId;
    form.name = userStore.user.name;
  } else {
    form.sendEmail = accountStore.currentAccount.email;
    form.accountId = accountStore.currentAccount.accountId;
    form.name = accountStore.currentAccount.name;
  }
  show.value = true;
  
  // 获取当前账户的签名列表和SMTP账户列表
  if (form.accountId > 0) {
    // 签名和SMTP独立加载，互不影响
    try {
      const signatureList = await getSignatures(form.accountId);
      signatures.value = signatureList;
      const defaultSignature = signatureList.find(sig => sig.isDefault);
      if (defaultSignature) {
        selectedSignatureId.value = defaultSignature.id;
        setTimeout(() => {
          const content = editor.value.getContent();
          editor.value.setContent(insertSignatureIntoContent(content, defaultSignature));
        }, 100);
      } else {
        selectedSignatureId.value = '';
      }
    } catch (error) {
      console.error('获取签名失败:', error);
    }
    
    try {
      const smtpAccountListResult = await smtpAccountList(form.accountId);
      smtpAccounts.value = smtpAccountListResult;
      const defaultSmtpAccount = smtpAccountListResult.find(acc => acc.isDefault === 1);
      if (defaultSmtpAccount) {
        selectedSmtpAccountId.value = defaultSmtpAccount.smtpAccountId;
        form.smtpAccountId = defaultSmtpAccount.smtpAccountId;
      } else if (smtpAccountListResult.length > 0) {
        selectedSmtpAccountId.value = smtpAccountListResult[0].smtpAccountId;
        form.smtpAccountId = smtpAccountListResult[0].smtpAccountId;
      }
    } catch (error) {
      console.error('获取SMTP账户失败:', error);
    }
  }
  
  editor.value.focus()
}

function getSignatureHtml(signature) {
  if (!signature) return ''
  return `<div class="email-signature" data-signature-id="${signature.id}"><br>${signature.content}</div>`
}

function removeSignatureFromContent(content) {
  const tmp = document.createElement('div')
  tmp.innerHTML = content
  tmp.querySelectorAll('.email-signature').forEach(el => el.remove())
  return tmp.innerHTML
}

function insertSignatureIntoContent(content, signature) {
  if (!signature) return content
  const sigHtml = getSignatureHtml(signature)
  const cleaned = removeSignatureFromContent(content)

  const tmp = document.createElement('div')
  tmp.innerHTML = cleaned

  // Reply: insert before blockquote area
  const blockquote = tmp.querySelector('blockquote')
  if (blockquote) {
    let target = blockquote
    const prev = blockquote.previousElementSibling
    if (prev && prev.textContent.includes('wrote:')) {
      target = prev
    }
    target.insertAdjacentHTML('beforebegin', sigHtml)
    return tmp.innerHTML
  }

  // Forward: insert before forward header
  for (const child of [...tmp.children]) {
    if (child.textContent.includes('Forwarded message') && child.textContent.includes('---')) {
      child.insertAdjacentHTML('beforebegin', sigHtml)
      return tmp.innerHTML
    }
  }

  // New mail: append at end
  tmp.insertAdjacentHTML('beforeend', sigHtml)
  return tmp.innerHTML
}

function handleSignatureChange(signatureId) {
  const content = editor.value.getContent()
  if (!signatureId) {
    editor.value.setContent(removeSignatureFromContent(content))
    return
  }
  const selectedSignature = signatures.value.find(sig => sig.id === signatureId)
  if (!selectedSignature) return
  editor.value.setContent(insertSignatureIntoContent(content, selectedSignature))
}

// 处理SMTP账户选择变化
function handleSmtpAccountChange(smtpAccountId) {
  form.smtpAccountId = smtpAccountId;
}

function changeLang(lang) {
  setExtend(lang === 'en' ? 'en' : 'zh-cn')
  settingStore.lang = lang
}

function openDraft(draft) {
  Object.assign(form, {...draft})
  defValue.value = ''
  setTimeout(() => defValue.value = form.content)
  show.value = true;
  editor.value.focus()
}

const handleKeyDown = (event) => {
  if (event.key === 'Escape') {
    close()
  }
};

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
});

function close() {

  if (selectStatus) openSelect();

  if (!form.content) {
    form.content = editor.value.getContent();
  }

  if (form.draftId) {
    draftStore.setDraft = {...toRaw(form)}
    show.value = false
    resetForm()
    return;
  }

  if (!(form.content || form.subject || form.receiveEmail.length > 0)) {
    show.value = false
    resetForm()
    return;
  }

  if (backReply.sendType === 'reply' || backReply.sendType === 'forward') {
    let subjectFlag = form.subject === backReply.subject
    let contentFlag = editor.value.getContent() === backReply.content
    let receiveFlag = form.receiveEmail.length === 1 && form.receiveEmail[0] === backReply.receiveEmail[0]
    if (backReply.sendType === 'forward' && form.receiveEmail.length === 0) {
      receiveFlag = true;
    }
    if (subjectFlag && contentFlag && receiveFlag) {
      resetForm();
      close()
      return;
    }
  }

  ElMessageBox.confirm(t('saveDraftConfirm'), {
    confirmButtonText: t('confirm'),
    cancelButtonText: t('cancel'),
    type: 'warning',
    distinguishCancelAndClose: true
  }).then(async () => {
    const formData = {...toRaw(form)};
    delete formData.draftId
    delete formData.attachments
    formData.createTime = dayjs().utc().format('YYYY-MM-DD HH:mm:ss');
    const draftId = await db.value.draft.add({...formData})
    db.value.att.add({draftId, attachments: toRaw(form.attachments)})
    draftStore.refreshList++
    show.value = false
    await nextTick(() => {
      resetForm()
    })
  }).catch((action) => {
    if (action === 'cancel') {
      show.value = false
      resetForm()
    }
  })

}

</script>
<style>
.write-select .el-select-dropdown__list {
  padding: 4px 4px !important;
}
.write-select .el-select-dropdown__item {
  padding: 0 10px 0 10px;
}

.write-select .el-select-dropdown {
  min-width: 0 !important;
}
</style>
<style scoped lang="scss">
.send {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 210;

  .write-box {
    background: var(--el-bg-color);
    width: min(1367px, calc(100% - 80px));
    box-shadow: var(--el-box-shadow-light);
    border: 1px solid var(--el-border-color-light);
    transition: var(--el-transition-duration);
    padding: 15px;
    border-radius: 8px;
    display: grid;
    grid-template-rows: auto 1fr;
    overflow: hidden;
    @media (max-width: 1024px) {
      width: 100%;
      height: 100%;
      border-radius: 0;
      border: 0;
      padding-top: 10px;
    }
    @media (min-width: 1025px) {
      height: min(800px, calc(100vh - 60px));
    }

    .title {
        display: flex;
        justify-content: space-between;
        margin-bottom: 10px;

        .title-left {
          align-items: center;
          display: grid;
          grid-template-columns: auto auto auto auto 1fr;
          gap: 10px;
        }

        .title-text {
        }

        .sender {
          margin-left: 8px;
        }

        .sender-name {
          margin-left: 8px;
          font-weight: bold;
        }

        .send-email {
          color: #999896;
          margin-left: 5px;
          white-space: nowrap;
          text-overflow: ellipsis;
          overflow: hidden;
        }

        div {
          display: flex;
          align-items: center;
        }
      }

      .lang-switch {
        width: 30px;
        height: 30px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        user-select: none;
        &:hover {
          background: var(--base-fill);
        }
      }

    .container {
      height: 100%;
      display: grid;
      grid-template-rows: auto auto 1fr auto;
      gap: 15px;

      .item-title {
      }

      .button-item {
        display: grid;
        grid-template-columns: auto auto 1fr auto;

        @media (max-width: 767px) {
          grid-template-columns: auto auto 1fr;
          grid-template-rows: auto auto;

          .send-actions {
            grid-column: 1 / -1;
            grid-row: 1;
            justify-content: flex-start;
            flex-wrap: wrap;
            margin-bottom: 6px;
          }
        }

        .send-actions {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          @media (max-width: 767px) {
            gap: 6px;
          }
        }

        .signature-select {
          min-width: 140px;
          @media (max-width: 767px) {
            min-width: 110px;
          }
        }

        .smtp-account-select {
          min-width: 170px;
          @media (max-width: 767px) {
            min-width: 130px;
          }
        }

        .att-add {
          cursor: pointer;
        }

        .att-clear {
          cursor: pointer;
          margin-left: 10px;
        }

        .att-list {
          display: grid;
          gap: 5px;
          grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
          padding-left: 10px;
          padding-right: 10px;
          max-height: 110px;
          overflow-y: auto;
          @media (max-width: 450px) {
            grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
          }

          .att-item {
            display: grid;
            grid-template-columns: auto 1fr auto auto;
            gap: 5px;
            height: 32px;
            font-size: 14px;
            padding: 4px 5px;
            background: var(--light-ill);
            border-radius: 4px;
            .att-filename {
              white-space: nowrap;
              text-overflow: ellipsis;
              overflow: hidden;
            }
          }
        }
      }
    }
  }

}

.email-row {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

:deep(.el-dialog) {
  width: 420px !important;
  @media (max-width: 460px) {
    width: calc(100% - 40px) !important;
    margin-right: 20px !important;
    margin-left: 20px !important;
  }
}

.contacts-bottom {
  display: flex;
  justify-content: end;
  margin-top: 10px;
}

.add-contact {
  color: var(--regular-text-color)
}

.write-select {
  position: absolute;
  width: 300px;
  left: 60px;
  z-index: 0;
  opacity: 0;
  pointer-events: none;
}

:deep(.el-input-tag__suffix) {
  padding-right: 4px;
}

.icon {
  cursor: pointer;
}
</style>
