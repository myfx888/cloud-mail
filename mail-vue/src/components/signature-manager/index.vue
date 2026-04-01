<template>
  <el-dialog v-model="visible" :title="$t('signatureManager')" width="720" @closed="onClosed" :close-on-click-modal="false">
    <div class="signature-manager">
      <div class="signature-list">
        <div class="signature-list-header">
          <span>{{ $t('signatureManager') }}</span>
          <el-button type="primary" size="small" @click="addNew">
            <Icon icon="ion:add-outline" width="16" height="16" />
            {{ $t('addSignature') }}
          </el-button>
        </div>
        <el-scrollbar class="signature-list-body" max-height="400px">
          <div
            v-for="sig in signatureList"
            :key="sig.id"
            class="signature-item"
            :class="{ 'signature-item-active': currentSignature?.id === sig.id }"
            @click="selectSignature(sig)"
          >
            <div class="signature-item-info">
              <span class="signature-item-name">{{ sig.name }}</span>
              <el-tag v-if="sig.isDefault" type="success" size="small">{{ $t('defaultSignature') }}</el-tag>
            </div>
            <div class="signature-item-actions" @click.stop>
              <el-button v-if="!sig.isDefault" link size="small" @click="setDefault(sig)">{{ $t('setDefault') }}</el-button>
              <el-button link type="danger" size="small" @click="remove(sig)">{{ $t('delete') }}</el-button>
            </div>
          </div>
          <el-empty v-if="signatureList.length === 0" :description="$t('noSignature')" :image-size="60" />
        </el-scrollbar>
      </div>
      <div class="signature-editor" v-if="currentSignature">
        <div class="signature-editor-header">
          <el-input v-model="currentSignature.name" :placeholder="$t('signatureName')" size="small" style="max-width: 300px" />
          <el-button type="primary" size="small" :loading="saving" @click="save">{{ $t('save') }}</el-button>
        </div>
        <div class="signature-editor-body">
          <textarea :id="editorId" ref="editorRef"></textarea>
        </div>
      </div>
      <div class="signature-editor signature-editor-empty" v-else-if="signatureList.length > 0">
        <el-empty :description="$t('selectSignature')" :image-size="80" />
      </div>
    </div>
  </el-dialog>
</template>

<script setup>
import { ref, watch, nextTick, onBeforeUnmount, shallowRef, computed } from 'vue'
import { Icon } from '@iconify/vue'
import { getSignatures, addSignature, updateSignature, deleteSignature, setDefaultSignature } from '@/request/setting.js'
import { useI18n } from 'vue-i18n'
import { useUiStore } from '@/store/ui.js'

const { t } = useI18n()
const uiStore = useUiStore()

const props = defineProps({
  accountId: {
    type: Number,
    default: 0
  }
})

const emit = defineEmits(['update:modelValue', 'updated'])

const visible = ref(false)
const signatureList = ref([])
const currentSignature = ref(null)
const saving = ref(false)
const editor = shallowRef(null)
const editorRef = ref(null)
const editorId = `sig-editor-${Date.now()}`

function open() {
  visible.value = true
  loadSignatures()
}

function onClosed() {
  destroyEditor()
  currentSignature.value = null
}

async function loadSignatures() {
  if (!props.accountId) return
  try {
    signatureList.value = await getSignatures(props.accountId)
  } catch (e) {
    console.error('Failed to load signatures:', e)
    signatureList.value = []
  }
}

function selectSignature(sig) {
  currentSignature.value = { ...sig }
  nextTick(() => {
    initEditor(sig.content || '')
  })
}

function addNew() {
  currentSignature.value = {
    id: null,
    name: '',
    content: '',
    isDefault: signatureList.value.length === 0
  }
  nextTick(() => {
    initEditor('')
  })
}

async function save() {
  if (!currentSignature.value.name) {
    ElMessage({ message: t('signatureNameRequired'), type: 'error', plain: true })
    return
  }

  const content = editor.value ? editor.value.getContent() : currentSignature.value.content
  currentSignature.value.content = content
  saving.value = true

  try {
    if (currentSignature.value.id) {
      await updateSignature(props.accountId, currentSignature.value.id, {
        name: currentSignature.value.name,
        content: currentSignature.value.content,
        isDefault: currentSignature.value.isDefault
      })
    } else {
      const newSig = await addSignature(props.accountId, {
        name: currentSignature.value.name,
        content: currentSignature.value.content,
        isDefault: currentSignature.value.isDefault
      })
      currentSignature.value.id = newSig.id
    }
    ElMessage({ message: t('signatureSaveSuccess'), type: 'success', plain: true })
    await loadSignatures()
    emit('updated')

    const updated = signatureList.value.find(s => s.id === currentSignature.value.id)
    if (updated) {
      currentSignature.value = { ...updated }
    }
  } catch (e) {
    ElMessage({ message: e.message || 'Error', type: 'error', plain: true })
  } finally {
    saving.value = false
  }
}

async function remove(sig) {
  try {
    await ElMessageBox.confirm(t('deleteSignatureConfirm'), {
      confirmButtonText: t('confirm'),
      cancelButtonText: t('cancel'),
      type: 'warning'
    })
    await deleteSignature(props.accountId, sig.id)
    ElMessage({ message: t('signatureDeleteSuccess'), type: 'success', plain: true })
    if (currentSignature.value?.id === sig.id) {
      currentSignature.value = null
      destroyEditor()
    }
    await loadSignatures()
    emit('updated')
  } catch (e) {
    // cancelled or error
  }
}

async function setDefault(sig) {
  try {
    await setDefaultSignature(props.accountId, sig.id)
    ElMessage({ message: t('signatureSetDefaultSuccess'), type: 'success', plain: true })
    await loadSignatures()
    emit('updated')

    if (currentSignature.value?.id === sig.id) {
      currentSignature.value.isDefault = true
    }
  } catch (e) {
    ElMessage({ message: e.message || 'Error', type: 'error', plain: true })
  }
}

function initEditor(content) {
  destroyEditor()

  if (!window.tinymce) {
    const script = document.createElement('script')
    script.src = '/tinymce/tinymce.min.js'
    script.onload = () => createEditor(content)
    document.head.appendChild(script)
  } else {
    createEditor(content)
  }
}

function createEditor(content) {
  window.tinymce.init({
    selector: `#${editorId}`,
    statusbar: false,
    height: 300,
    forced_root_block: 'div',
    skin: `${uiStore.dark ? 'oxide-dark' : 'oxide'}`,
    content_css: `/tinymce/css/index.css,${uiStore.dark ? 'dark' : 'default'}`,
    plugins: 'link image advlist lists emoticons table code',
    toolbar: 'bold emoticons forecolor backcolor italic fontsize | alignleft aligncenter alignright | bullist numlist | link image | table code',
    toolbar_mode: 'scrolling',
    font_size_formats: '8px 10px 12px 14px 16px 18px 24px 36px',
    emoticons_search: false,
    menubar: false,
    license_key: 'gpl',
    branding: false,
    setup: (ed) => {
      editor.value = ed
      ed.on('init', () => {
        ed.setContent(content || '')
      })
    },
    file_picker_types: 'image',
    image_dimensions: false,
    image_description: false,
    link_title: false,
    file_picker_callback: (callback, value, meta) => {
      const input = document.createElement('input')
      input.setAttribute('type', 'file')
      input.setAttribute('accept', 'image/*')
      input.addEventListener('change', async (e) => {
        let file = e.target.files[0]
        const reader = new FileReader()
        reader.onload = () => {
          const id = 'blobid' + (new Date()).getTime()
          const blobCache = tinymce.activeEditor.editorUpload.blobCache
          const base64 = reader.result.split(',')[1]
          const blobInfo = blobCache.create(id, file, base64)
          blobCache.add(blobInfo)
          callback(blobInfo.blobUri(), { title: file.name })
        }
        reader.readAsDataURL(file)
      })
      input.click()
    }
  })
}

function destroyEditor() {
  if (editor.value) {
    editor.value.destroy()
    editor.value = null
  }
}

onBeforeUnmount(() => {
  destroyEditor()
})

defineExpose({ open })
</script>

<style scoped lang="scss">
.signature-manager {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 15px;
  min-height: 380px;

  @media (max-width: 640px) {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
  }
}

.signature-list {
  border-right: 1px solid var(--el-border-color-light);
  padding-right: 15px;

  @media (max-width: 640px) {
    border-right: none;
    border-bottom: 1px solid var(--el-border-color-light);
    padding-right: 0;
    padding-bottom: 10px;
  }

  .signature-list-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
    font-weight: 600;
  }
}

.signature-item {
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  margin-bottom: 4px;
  transition: background 0.2s;

  &:hover {
    background: var(--el-fill-color-light);
  }

  &.signature-item-active {
    background: var(--el-color-primary-light-9);
  }

  .signature-item-info {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 2px;
  }

  .signature-item-name {
    font-size: 14px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    flex: 1;
  }

  .signature-item-actions {
    display: flex;
    gap: 4px;
  }
}

.signature-editor {
  .signature-editor-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
    gap: 10px;
  }

  .signature-editor-body {
    border: 1px solid var(--el-border-color-light);
    border-radius: 4px;
    overflow: hidden;
  }
}

.signature-editor-empty {
  display: flex;
  align-items: center;
  justify-content: center;
}

:deep(.el-dialog) {
  max-width: 90vw;
}

:deep(.tox-tinymce) {
  border: none !important;
}
</style>
