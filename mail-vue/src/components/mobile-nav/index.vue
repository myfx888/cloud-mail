<template>
  <div class="mobile-nav" v-if="isMobile">
    <div class="nav-item" :class="{ active: route.meta.name === 'email' }" @click="navigate('email')">
      <Icon icon="hugeicons:mailbox-01" width="22" height="22" />
      <span>{{ $t('inbox') }}</span>
    </div>
    <div class="nav-item" :class="{ active: route.meta.name === 'send' }" @click="navigate('send')" v-perm="'email:send'">
      <Icon icon="cil:send" width="20" height="20" />
      <span>{{ $t('sent') }}</span>
    </div>
    <div class="nav-item compose-item" @click="openCompose" v-perm="'email:send'">
      <div class="compose-btn">
        <Icon icon="material-symbols:edit-outline-sharp" width="22" height="22" />
      </div>
      <span>{{ $t('compose') }}</span>
    </div>
    <div class="nav-item" :class="{ active: route.meta.name === 'setting' }" @click="navigate('setting')">
      <Icon icon="fluent:settings-48-regular" width="22" height="22" />
      <span>{{ $t('settings') }}</span>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import { Icon } from '@iconify/vue'
import router from '@/router/index.js'
import { useUiStore } from '@/store/ui.js'

const route = useRoute()
const uiStore = useUiStore()
const isMobile = ref(window.innerWidth < 767)

const handleResize = () => {
  isMobile.value = window.innerWidth < 767
}

onMounted(() => {
  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
})

function navigate(name) {
  router.push({ name })
}

function openCompose() {
  uiStore.writerRef.open()
}
</script>

<style scoped lang="scss">
.mobile-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 56px;
  padding-bottom: env(safe-area-inset-bottom);
  background: var(--el-bg-color);
  border-top: 1px solid var(--el-border-color);
  display: flex;
  justify-content: space-around;
  align-items: center;
  z-index: 200;

  .nav-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    flex: 1;
    cursor: pointer;
    color: var(--el-text-color-secondary);
    font-size: 11px;
    padding: 4px 0;
    user-select: none;
    -webkit-tap-highlight-color: transparent;

    &.active {
      color: var(--el-color-primary);
    }
  }

  .compose-item {
    .compose-btn {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: linear-gradient(135deg, #1890ff, #3a80dd);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-top: -16px;
      box-shadow: 0 2px 8px rgba(24, 144, 255, 0.3);
    }
  }
}
</style>
