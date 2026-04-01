<template>
  <div class="settings-container">
    <div class="loading" :class="firstLoading ? 'loading-show' : 'loading-hide'">
      <loading/>
    </div>
    <el-scrollbar class="scroll" v-if="!firstLoading">
      <div class="scroll-body">
        <div class="card-grid">
          <!-- Website Settings Card -->
          <div class="settings-card">
            <div class="card-title">{{ $t('websiteSetting') }}</div>
            <div class="card-content">
              <div class="setting-item">
                <div><span>{{ $t('websiteReg') }}</span></div>
                <div>
                  <el-switch @change="change" :before-change="beforeChange" :active-value="0" :inactive-value="1"
                             v-model="setting.register"/>
                </div>
              </div>
              <div class="setting-item">
                <div><span>{{ $t('loginDomain') }}</span></div>
                <div>
                  <el-switch @change="change" :before-change="beforeChange" :active-value="0" :inactive-value="1"
                             v-model="setting.loginDomain"/>
                </div>
              </div>
              <div class="setting-item">
                <div><span>登录页后缀显示</span></div>
                <div class="forward" style="flex-direction: column; align-items: flex-end; gap: 6px;">
                  <el-select
                    v-model="setting.loginDomains"
                    multiple
                    collapse-tags
                    collapse-tags-tooltip
                    :max-collapse-tags="2"
                    placeholder="默认全部显示"
                    style="width: 220px"
                    @change="saveLoginDomains"
                  >
                    <el-option
                      v-for="item in setting.domainList"
                      :key="item"
                      :label="item"
                      :value="item"
                    />
                  </el-select>
                  <span style="font-size: 12px; color: var(--el-text-color-secondary)">不选则显示全部后缀</span>
                </div>
              </div>
              <div class="setting-item">
                <div><span>{{ $t('regKey') }}</span></div>
                <div>
                  <el-select
                      @change="change"
                      :style="`width: ${ locale === 'en' ?  100 : 80 }px;`"
                      v-model="setting.regKey"
                      placeholder="Select"
                  >
                    <el-option
                        v-for="item in regKeyOptions"
                        :key="item.value"
                        :label="item.label"
                        :value="item.value"
                    />
                  </el-select>
                </div>
              </div>
              <div class="setting-item">
                <div><span>{{ $t('addAccount') }}</span></div>
                <div>
                  <el-switch @change="change" :before-change="beforeChange" :active-value="0" :inactive-value="1"
                             v-model="setting.addEmail"/>
                </div>
              </div>
              <div class="setting-item">
                <div>
                  <span>{{ $t('multipleEmail') }}</span>
                  <el-tooltip effect="dark" :content="$t('multipleEmailDesc')">
                    <Icon class="warning" icon="fe:warning" width="18" height="18"/>
                  </el-tooltip>
                </div>
                <div>
                  <el-switch @change="change" :before-change="beforeChange" :active-value="0" :inactive-value="1"
                             v-model="setting.manyEmail"/>
                </div>
              </div>
              <div class="setting-item">
                <div>
                  <span>{{ $t('emailPrefix') }}</span>
                </div>
                <div class="forward">
                  <el-button class="opt-button" size="small" type="primary" @click="openEmailPrefix">
                    <Icon icon="fluent:settings-48-regular" width="18" height="18"/>
                  </el-button>
                </div>
              </div>
            </div>
          </div>

          <!-- Personalization Settings Card -->
          <div class="settings-card">
            <div class="card-title">{{ $t('customization') }}</div>
            <div class="card-content">
              <div class="setting-item">
                <div class="title-item"><span>{{ $t('websiteTitle') }}</span></div>
                <div class="email-title">
                  <span>{{ setting.title }}</span>
                  <el-button class="opt-button" size="small" type="primary" @click="editTitleShow = true">
                    <Icon icon="lsicon:edit-outline" width="16" height="16"/>
                  </el-button>
                </div>
              </div>
              <div class="setting-item">
                <div class="title-item"><span>{{ $t('loginBoxOpacity') }}</span></div>
                <div>
                  <el-input-number size="small" v-model="loginOpacity" @change="opacityChange" :precision="2"
                                   :step="0.01" :max="1" :min="0"/>
                </div>
              </div>
              <div class="setting-item personalized">
                <div><span>{{ $t('loginBackground') }}</span></div>
                <div>
                  <el-image
                      class="background"
                      :src="cvtR2Url(setting.background)"
                      :preview-src-list="[cvtR2Url(setting.background)]"
                      show-progress
                      fit="cover"
                  >
                    <template #error>
                      <div class="error-image">
                        <Icon icon="ph:image" width="24" height="24"/>
                      </div>
                    </template>
                  </el-image>
                  <div class="background-btn">
                    <el-button class="opt-button" size="small" type="primary" @click="openSetBackground">
                      <Icon icon="lsicon:edit-outline" width="16" height="16"/>
                    </el-button>
                    <el-button class="opt-button" size="small" type="primary" @click="delBackground">
                      <Icon icon="material-symbols:delete-outline-rounded" width="16" height="16"/>
                    </el-button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Email Sending Settings Card -->
          <div class="settings-card">
            <div class="card-title">{{ $t('emailSetting') }}</div>
            <div class="card-content">
              <div class="setting-item">
                <div><span>{{ $t('receiveEmail') }}</span></div>
                <div>
                  <el-switch @change="change" :before-change="beforeChange" :active-value="0" :inactive-value="1"
                             v-model="setting.receive"/>
                </div>
              </div>
              <div class="setting-item">
                <div>
                  <span>{{ $t('autoRefresh') }}</span>
                  <el-tooltip effect="dark" :content="$t('autoRefreshDesc')">
                    <Icon class="warning" icon="fe:warning" width="18" height="18"/>
                  </el-tooltip>
                </div>
                <div>
                  <el-select
                      @change="change"
                      :style="`width: ${ locale === 'en' ? 100 : 80 }px;`"
                      v-model="setting.autoRefresh"
                      placeholder="Select"
                  >
                    <el-option
                        v-for="item in authRefreshOptions"
                        :key="item.value"
                        :label="item.label"
                        :value="item.value"
                    />
                  </el-select>
                </div>
              </div>
              <div class="setting-item">
                <div><span>{{ $t('sendEmail') }}</span></div>
                <div>
                  <el-switch @change="change" :before-change="beforeChange" :active-value="0" :inactive-value="1"
                             v-model="setting.send"/>
                </div>
              </div>
              <div class="setting-item">
                <div>
                  <span>{{ $t('noRecipientTitle') }}</span>
                  <el-tooltip effect="dark" :content="$t('noRecipientDesc')">
                    <Icon class="warning" icon="fe:warning" width="18" height="18"/>
                  </el-tooltip>
                </div>
                <div>
                  <el-switch @change="change" :before-change="beforeChange" :active-value="0" :inactive-value="1"
                             v-model="setting.noRecipient"/>
                </div>
              </div>
              <div class="setting-item" v-if="Number(setting.resendEnabled) === 1">
                <div><span>{{ $t('resendToken') }}</span></div>
                <div>
                  <el-button class="opt-button" style="margin-top: 0" @click="openResendList" size="small"
                             type="primary">
                    <Icon icon="ic:round-list" width="18" height="18"/>
                  </el-button>
                  <el-button class="opt-button" style="margin-top: 0" @click="openResendForm" size="small"
                             type="primary">
                    <Icon icon="material-symbols:add-rounded" width="16" height="16"/>
                  </el-button>
                </div>
              </div>
              <div class="setting-item">
                <div><span>Resend 开关</span></div>
                <div>
                  <el-switch @change="change" :before-change="beforeChange" :active-value="1" :inactive-value="0"
                             v-model="setting.resendEnabled"/>
                </div>
              </div>
            </div>
          </div>

          <!-- SMTP Settings Card -->
          <div class="settings-card">
            <div class="card-title">{{ $t('smtpSetting') }}</div>
            <div class="card-content">
              <div class="setting-item">
                <div><span>{{ $t('smtpEnabled') }}</span></div>
                <div>
                  <el-switch @change="change" :before-change="beforeChange" :active-value="1" :inactive-value="0"
                             v-model="setting.smtpEnabled"/>
                </div>
              </div>
            </div>
          </div>

          <div class="settings-card">
            <div class="card-title">Mailcow</div>
            <div class="card-content">
              <div class="setting-item">
                <div><span>Mailcow 开关</span></div>
                <div>
                  <el-switch @change="change" :before-change="beforeChange" :active-value="1" :inactive-value="0"
                             v-model="setting.mailcowEnabled"/>
                </div>
              </div>
              <div class="setting-item">
                <div><span>Mailcow 服务器</span></div>
                <div class="forward">
                  <el-tag v-if="mailcowServerCount > 0" type="success" size="small">{{ mailcowServerCount }} 个</el-tag>
                  <el-tag v-else type="info" size="small">未配置</el-tag>
                  <el-button class="opt-button" size="small" type="primary" @click="openMailcowConfig">
                    <Icon icon="fluent:settings-48-regular" width="18" height="18"/>
                  </el-button>
                </div>
              </div>
              <div class="setting-item">
                <div><span>SMTP 服务器</span></div>
                <div class="forward">
                  <el-tag v-if="smtpServerCount > 0" type="success" size="small">{{ smtpServerCount }} 个</el-tag>
                  <el-tag v-else type="info" size="small">未配置</el-tag>
                </div>
              </div>
            </div>
          </div>

          <!-- Object Storage Card -->
          <div class="settings-card">
            <div class="card-title">{{ $t('oss') }}</div>
            <div class="card-content">
              <div class="r2domain-item">
                <div>
                  <span>{{ $t('osDomain') }}</span>
                  <el-tooltip effect="dark" :content="$t('ossDomainDesc')">
                    <Icon class="warning" icon="fe:warning" width="18" height="18"/>
                  </el-tooltip>
                </div>
                <div class="r2domain">
                  <span>{{ setting.r2Domain || '' }}</span>
                  <el-button class="opt-button" size="small" type="primary" @click="r2DomainShow = true">
                    <Icon icon="lsicon:edit-outline" width="16" height="16"/>
                  </el-button>
                </div>
              </div>
              <div class="setting-item">
                <div>
                  <span>{{ $t('s3Configuration') }}</span>
                </div>
                <div class="r2domain">
                  <el-button class="opt-button" size="small" type="primary" @click="addS3Show = true">
                    <Icon icon="fluent:settings-48-regular" width="16" height="16"/>
                  </el-button>
                </div>
              </div>
              <div class="setting-item">
                <div>
                  <span>{{ $t('storageType') }}</span>
                </div>
                <div class="r2domain">
                  <div class="storage-type">
                    <el-tag>{{ setting.storageType }}</el-tag>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="settings-card">
            <div class="card-title">{{ $t('emailPush') }}</div>
            <div class="card-content">
              <div class="setting-item">
                <div><span>{{ $t('tgBot') }}</span></div>
                <div class="forward">
                  <span>{{ setting.tgBotStatus === 0 ? $t('enabled') : $t('disabled') }}</span>
                  <el-button class="opt-button" size="small" type="primary" @click="openTgSetting">
                    <Icon icon="fluent:settings-48-regular" width="18" height="18"/>
                  </el-button>
                </div>
              </div>
              <div class="setting-item">
                <div><span>{{ $t('otherEmail') }}</span></div>
                <div class="forward">
                  <span>{{ setting.forwardStatus === 0 ? $t('enabled') : $t('disabled') }}</span>
                  <el-button class="opt-button" size="small" type="primary" @click="openThirdEmailSetting">
                    <Icon icon="fluent:settings-48-regular" width="18" height="18"/>
                  </el-button>
                </div>
              </div>
              <div class="setting-item">
                <div><span>{{ $t('forwardingRules') }}</span></div>
                <div class="forward">
                  <span>{{ setting.ruleType === 0 ? $t('forwardAll') : $t('rules') }}</span>
                  <el-button class="opt-button" size="small" type="primary" @click="openForwardRules">
                    <Icon icon="fluent:settings-48-regular" width="18" height="18"/>
                  </el-button>
                </div>
              </div>
            </div>
          </div>

          <!-- Turnstile Verification Card -->
          <div class="settings-card">
            <div class="card-title">{{ $t('turnstileSetting') }}</div>
            <div class="card-content">
              <div class="setting-item">
                <div><span>{{ $t('signUpVerification') }}</span></div>
                <div>
                  <el-button class="opt-button" size="small" type="primary" @click="openRegVerifyCount">
                    <Icon icon="fluent:settings-48-regular" width="18" height="18"/>
                  </el-button>
                  <el-select
                      @change="change"
                      :style="`width: ${ locale === 'en' ? 100 : 80 }px;`"
                      v-model="setting.registerVerify"
                      placeholder="Select"
                      class="bot-verify-select"
                  >
                    <el-option key="1" :value="0" :label="$t('enable')"/>
                    <el-option key="1" :value="1" :label="$t('disable')"/>
                    <el-option key="1" :value="2" :label="$t('rulesVerify')"/>
                  </el-select>
                </div>
              </div>
              <div class="setting-item">
                <div><span>{{ $t('addEmailVerification') }}</span></div>
                <div>
                  <el-button class="opt-button" size="small" type="primary" @click="openAddVerifyCount">
                    <Icon icon="fluent:settings-48-regular" width="18" height="18"/>
                  </el-button>
                  <el-select
                      @change="change"
                      :style="`width: ${ locale === 'en' ? 100 : 80 }px;`"
                      v-model="setting.addEmailVerify"
                      placeholder="Select"
                      class="bot-verify-select"
                  >
                    <el-option key="1" :value="0" :label="$t('enable')"/>
                    <el-option key="1" :value="1" :label="$t('disable')"/>
                    <el-option key="1" :value="2" :label="$t('rulesVerify')"/>
                  </el-select>
                </div>
              </div>
              <div class="setting-item">
                <div><span>Site Key</span></div>
                <div class="bot-verify">
                  <span>{{ setting.siteKey }}</span>
                  <el-button class="opt-button" size="small" type="primary" @click="turnstileShow = true">
                    <Icon icon="lsicon:edit-outline" width="16" height="16"/>
                  </el-button>
                </div>
              </div>
              <div class="setting-item">
                <div><span>Secret Key</span></div>
                <div class="bot-verify">
                  <span> {{ setting.secretKey }} </span>
                  <el-button class="opt-button" size="small" type="primary" @click="turnstileShow = true">
                    <Icon icon="lsicon:edit-outline" width="16" height="16"/>
                  </el-button>
                </div>
              </div>
            </div>
          </div>

          <div class="settings-card">
            <div class="card-title">{{ $t('noticeTitle') }}</div>
            <div class="card-content">
              <div class="setting-item">
                <div><span>{{ $t('noticePopup') }}</span></div>
                <div class="forward">
                  <span>{{ setting.notice === 0 ? $t('enabled') : $t('disabled') }}</span>
                  <el-button class="opt-button" size="small" type="primary" @click="openNoticePopupSetting">
                    <Icon icon="fluent:settings-48-regular" width="18" height="18"/>
                  </el-button>
                </div>
              </div>
              <div class="setting-item">
                <div><span>{{ $t('popUp') }}</span></div>
                <div class="forward">
                  <el-button class="opt-button" size="small" type="primary" @click="openNoticePopup">
                    <Icon icon="mynaui:click-solid" width="18" height="18"/>
                  </el-button>
                </div>
              </div>
            </div>
          </div>

          <div class="settings-card about">
            <div class="card-title">{{ $t('about') }}</div>
            <div class="card-content">
              <div class="concerning-item">
                <span>{{ $t('version') }} :</span>
                <el-badge is-dot :hidden="!hasUpdate">
                  <el-button @click="jump('https://github.com/maillab/cloud-mail/releases')">
                    {{ currentVersion }}
                    <template #icon>
                      <Icon icon="qlementine-icons:version-control-16" style="font-size: 20px" color="#1890FF"/>
                    </template>
                  </el-button>
                </el-badge>
              </div>
              <div class="concerning-item">
                <span>{{ $t('community') }} : </span>
                <div class="community">
                  <el-button @click="jump('https://github.com/maillab/cloud-mail')">
                    Github
                    <template #icon>
                      <Icon icon="codicon:github-inverted" width="22" height="22"/>
                    </template>
                  </el-button>
                  <el-button @click="jump('https://t.me/cloud_mail_tg')">
                    Telegram
                    <template #icon>
                      <Icon icon="logos:telegram" width="30" height="30"/>
                    </template>
                  </el-button>
                </div>
              </div>
              <div class="concerning-item">
                <span>{{ $t('support') }} : </span>
                <el-button @click="jump('https://doc.skymail.ink/support.html')">
                  {{ t('supportDesc') }}
                  <template #icon>
                    <Icon color="#79D6B5" icon="simple-icons:buymeacoffee" width="20" height="20"/>
                  </template>
                </el-button>
              </div>
              <div class="concerning-item">
                <span>{{ $t('help') }} : </span>
                <el-button @click="jump('https://doc.skymail.ink')">
                  {{ t('document') }}
                  <template #icon>
                    <Icon color="#79D6B5" icon="fluent-color:document-32" width="18" height="18"/>
                  </template>
                </el-button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Dialogs remain the same -->
      <el-dialog v-model="editTitleShow" :title="$t('changeTitle')" width="340" @closed="editTitle = setting.title">
        <form>
          <el-input type="text" :placeholder="$t('websiteTitle')" v-model="editTitle"/>
          <el-button type="primary" :loading="settingLoading" @click="saveTitle">{{ $t('save') }}</el-button>
        </form>
      </el-dialog>
      <el-dialog v-model="resendTokenFormShow" :title="$t('resendToken')" width="340" @closed="cleanResendTokenForm">
        <form>
          <el-select style="margin-bottom: 15px" v-model="resendTokenForm.domain" placeholder="Select">
            <el-option
                v-for="item in settingStore.domainList"
                :key="item"
                :label="item"
                :value="item"
            />
          </el-select>
          <el-input type="text" :placeholder="$t('addResendTokenDesc')" v-model="resendTokenForm.token"/>
          <el-button type="primary" :loading="settingLoading" @click="saveResendToken">{{ $t('save') }}</el-button>
        </form>
      </el-dialog>
      <el-dialog v-model="r2DomainShow" :title="$t('addOsDomain')" width="340"
                 @closed="r2DomainInput = setting.r2Domain">
        <form>
          <el-input type="text" :placeholder="$t('domainDesc')" v-model="r2DomainInput"/>
          <el-button type="primary" :loading="settingLoading" @click="saveR2domain">{{ $t('save') }}</el-button>
        </form>
      </el-dialog>
      <el-dialog v-model="turnstileShow" :title="$t('addTurnstileSecret')" width="340"
                 @closed="turnstileForm.secretKey = '';turnstileForm.siteKey = ''">
        <form>
          <el-input type="text" placeholder="Site Key" v-model="turnstileForm.siteKey"/>
          <el-input type="text" style="margin-top: 15px" placeholder="Secret Key" v-model="turnstileForm.secretKey"/>
          <el-button type="primary" :loading="settingLoading" @click="saveTurnstileKey">{{ $t('save') }}</el-button>
        </form>
      </el-dialog>
      <el-dialog v-model="mailcowConfigShow" title="Mailcow 配置中心" width="700" class="mailcow-config-dialog" @closed="resetMailcowConfig">
        <el-tabs v-model="mailcowActiveTab">
          <!-- Tab 1: Global Settings -->
          <el-tab-pane label="全局设置" name="global">
            <el-form label-position="top" class="mailcow-form">
              <el-form-item label="密码模式">
                <el-select v-model="mailcowEdit.passwordMode" style="width: 100%">
                  <el-option label="随机密码" value="random"/>
                  <el-option label="固定密码" value="fixed"/>
                </el-select>
              </el-form-item>
              <el-form-item v-if="mailcowEdit.passwordMode === 'fixed'" label="统一密码（留空不更新）">
                <el-input v-model="mailcowEdit.provisionPassword" type="password" show-password/>
              </el-form-item>
              <el-form-item label="失败阻断">
                <el-switch :active-value="1" :inactive-value="0" v-model="mailcowEdit.createStrict"/>
                <span class="form-hint">开启后 Mailcow 创建失败将阻止本地账户创建</span>
              </el-form-item>
              <el-form-item label="重试次数">
                <el-input-number v-model="mailcowEdit.retryCount" :min="1" :max="10"/>
              </el-form-item>
              <el-form-item label="请求超时 (ms)">
                <el-input-number v-model="mailcowEdit.timeout" :min="5000" :max="120000" :step="5000"/>
              </el-form-item>
              
              <!-- Global SMTP Template (structured, not JSON textarea) -->
              <el-divider content-position="left">全局 SMTP 模板</el-divider>
              <div class="smtp-template-grid">
                <el-form-item label="SMTP 主机">
                  <el-input v-model="mailcowEdit.globalSmtpTemplate.smtpHost" placeholder="smtp.example.com"/>
                </el-form-item>
                <el-form-item label="端口">
                  <el-input-number v-model="mailcowEdit.globalSmtpTemplate.smtpPort" :min="1" :max="65535"/>
                </el-form-item>
                <el-form-item label="加密方式">
                  <el-select v-model="mailcowEdit.globalSmtpTemplate.smtpSecure">
                    <el-option label="无加密" :value="0"/>
                    <el-option label="STARTTLS" :value="1"/>
                    <el-option label="SSL/TLS" :value="2"/>
                  </el-select>
                </el-form-item>
                <el-form-item label="认证类型">
                  <el-select v-model="mailcowEdit.globalSmtpTemplate.smtpAuthType">
                    <el-option label="PLAIN" value="plain"/>
                    <el-option label="LOGIN" value="login"/>
                  </el-select>
                </el-form-item>
              </div>
            </el-form>
          </el-tab-pane>
          
          <!-- Tab 2: Mailcow Servers -->
          <el-tab-pane label="Mailcow 服务器" name="mailcow">
            <div class="server-toolbar">
              <el-button type="primary" size="small" @click="addMailcowServer">添加服务器</el-button>
              <el-button size="small" @click="testAllMailcowConnections" :loading="mailcowTestingAll">测试全部连接</el-button>
            </div>
            <el-table :data="mailcowEdit.servers" stripe size="small" class="server-table">
              <el-table-column prop="name" label="名称" min-width="100"/>
              <el-table-column prop="apiUrl" label="API 地址" min-width="150" show-overflow-tooltip/>
              <el-table-column label="默认" width="60" align="center">
                <template #default="{ row }">
                  <el-tag v-if="row.isDefault" type="success" size="small">默认</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="状态" width="80" align="center">
                <template #default="{ row }">
                  <el-tag v-if="row._testResult?.success" type="success" size="small">正常</el-tag>
                  <el-tag v-else-if="row._testResult?.success === false" type="danger" size="small">失败</el-tag>
                  <el-tag v-else type="info" size="small">未测试</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="200" align="center">
                <template #default="{ row, $index }">
                  <el-button size="small" link type="primary" @click="editMailcowServer($index)">编辑</el-button>
                  <el-button size="small" link type="primary" @click="testMailcowServerConnection($index)" 
                             :loading="row._testing">测试</el-button>
                  <el-button size="small" link type="danger" @click="deleteMailcowServer($index)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>
          
          <!-- Tab 3: SMTP Servers -->
          <el-tab-pane label="SMTP 服务器" name="smtp">
            <div class="server-toolbar">
              <el-button type="primary" size="small" @click="addSmtpServer">添加服务器</el-button>
            </div>
            <el-table :data="mailcowEdit.smtpServers" stripe size="small" class="server-table">
              <el-table-column prop="name" label="名称" min-width="100"/>
              <el-table-column prop="smtpHost" label="SMTP 主机" min-width="140" show-overflow-tooltip/>
              <el-table-column prop="smtpPort" label="端口" width="70" align="center"/>
              <el-table-column label="加密" width="80" align="center">
                <template #default="{ row }">
                  {{ ['无', 'STARTTLS', 'SSL'][row.smtpSecure] || '无' }}
                </template>
              </el-table-column>
              <el-table-column label="默认" width="60" align="center">
                <template #default="{ row }">
                  <el-tag v-if="row.isDefault" type="success" size="small">默认</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="140" align="center">
                <template #default="{ row, $index }">
                  <el-button size="small" link type="primary" @click="editSmtpServer($index)">编辑</el-button>
                  <el-button size="small" link type="danger" @click="deleteSmtpServer($index)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>
        </el-tabs>
        
        <template #footer>
          <div class="mailcow-dialog-footer">
            <el-switch v-model="mailcowAdvancedMode" active-text="高级模式"/>
            <div>
              <el-button @click="mailcowConfigShow = false">取消</el-button>
              <el-button type="primary" :loading="settingLoading" @click="saveMailcowConfig">保存</el-button>
            </div>
          </div>
        </template>
      </el-dialog>


      <!-- Server Edit Sub-Dialog (for both Mailcow and SMTP servers) -->
      <el-dialog v-model="mailcowServerFormShow" :title="mailcowServerFormTitle" width="480" append-to-body>
        <el-form label-position="top" class="mailcow-form">
          <el-form-item label="名称" required>
            <el-input v-model="mailcowServerForm.name" placeholder="服务器名称"/>
          </el-form-item>
          <el-form-item v-if="mailcowServerFormType === 'mailcow'" label="API 地址" required>
            <el-input v-model="mailcowServerForm.apiUrl" placeholder="https://mail.example.com"/>
          </el-form-item>
          <el-form-item v-if="mailcowServerFormType === 'mailcow'" label="API Key" required>
            <el-input v-model="mailcowServerForm.apiKey" type="password" show-password 
                      :placeholder="mailcowServerForm._editIndex >= 0 ? '留空不更新' : '输入 API Key'"/>
          </el-form-item>
          <el-form-item v-if="mailcowServerFormType === 'mailcow'" label="关联 SMTP 服务器">
            <el-select v-model="mailcowServerForm.smtpServerId" style="width: 100%" clearable placeholder="选择已配置的 SMTP 服务器">
              <el-option
                v-for="smtp in mailcowEdit.smtpServers"
                :key="smtp.id"
                :label="smtp.name || smtp.smtpHost"
                :value="smtp.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="SMTP 主机">
            <el-input v-model="mailcowServerForm.smtpHost" placeholder="smtp.example.com（留空使用全局模板）"/>
          </el-form-item>
          <el-form-item label="SMTP 端口">
            <el-input-number v-model="mailcowServerForm.smtpPort" :min="1" :max="65535" placeholder="587"/>
          </el-form-item>
          <el-form-item label="加密方式">
            <el-select v-model="mailcowServerForm.smtpSecure" style="width: 100%">
              <el-option label="无加密" :value="0"/>
              <el-option label="STARTTLS" :value="1"/>
              <el-option label="SSL/TLS" :value="2"/>
            </el-select>
          </el-form-item>
          <el-form-item label="认证类型">
            <el-select v-model="mailcowServerForm.smtpAuthType" style="width: 100%">
              <el-option label="PLAIN" value="plain"/>
              <el-option label="LOGIN" value="login"/>
            </el-select>
          </el-form-item>
          <el-form-item label="默认服务器">
            <el-switch v-model="mailcowServerForm.isDefault"/>
          </el-form-item>
          
          <!-- Dependency warning for edit mode -->
          <el-alert v-if="mailcowServerForm._dependencies > 0" type="warning" :closable="false" show-icon>
            此服务器已绑定 {{ mailcowServerForm._dependencies }} 个账户
          </el-alert>
        </el-form>
        <template #footer>
          <el-button @click="mailcowServerFormShow = false">取消</el-button>
          <el-button type="primary" @click="saveMailcowServerForm">确定</el-button>
        </template>
      </el-dialog>

      <!-- Advanced Mode JSON Dialog -->
      <el-dialog v-model="mailcowAdvancedShow" title="高级模式 - JSON 导入导出" width="600" append-to-body>
        <el-input type="textarea" v-model="mailcowAdvancedJson" :rows="15" placeholder="粘贴 JSON 配置..."/>
        <div class="advanced-actions">
          <el-button size="small" @click="exportMailcowJson">导出当前配置</el-button>
          <el-button size="small" type="primary" @click="importMailcowJson">导入并应用</el-button>
        </div>
      </el-dialog>
      <el-dialog
          v-model="showSetBackground"
          class="cut-dialog"
          @closed="closedSetBackground"
      >
        <template #header>
          <span style="font-size: 18px">
            {{ $t('backgroundTitle') }}
            <el-tooltip>
              <template #content>
                <span>{{ $t('backgroundWarning') }}</span>
              </template>
              <Icon class="title-icon  warning" icon="fe:warning" width="18" height="18"/>
            </el-tooltip>
          </span>
        </template>
        <el-input :placeholder="$t('backgroundUrlDesc')" v-model="backgroundUrl" v-if="!localUpShow"
                  class="background-url"/>
        <el-image
            v-if="localUpShow"
            :preview-src-list="[backgroundImage]"
            show-progress
            class="cropper"
            fit="cover"
            :src="backgroundImage"
        ></el-image>
        <div class="cut-button">
          <el-button type="primary" link @click="openCut" v-if="!localUpShow">
            {{ $t('localUpload') }}
          </el-button>
          <el-button type="primary" link @click="localUpShow = false" v-if="localUpShow">
            {{ $t('imageLink') }}
          </el-button>
          <el-button type="primary" :loading="settingLoading" @click="saveBackground">{{ $t('save') }}</el-button>
        </div>
      </el-dialog>
      <el-dialog
          v-model="tgSettingShow"
          class="forward-dialog"
      >
        <template #header>
          <div class="forward-head">
            <span class="forward-set-title">{{ $t('tgBot') }}</span>
            <el-tooltip effect="dark" :content="$t('tgBotDesc')">
              <Icon class="warning" icon="fe:warning" width="18" height="18"/>
            </el-tooltip>
          </div>
        </template>
        <div class="forward-set-body">
          <el-input :placeholder="$t('tgBotToken')" v-model="tgBotToken"></el-input>
          <el-input-tag tag-type="warning" :placeholder="$t('toBotTokenDesc')" v-model="tgChatId"
                        @add-tag="addChatTag"></el-input-tag>
          <el-input tag-type="warning" :placeholder="$t('customDomainDesc')" v-model="customDomain" ></el-input>
          <div class="tg-msg-label">
            <span>{{t('from')}}</span>
            <el-select  v-model="tgMsgFrom" >
              <el-option
                  v-for="item in tgMsgFromOption"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value"
              />
            </el-select>
          </div>
          <div class="tg-msg-label">
            <span>{{t('recipient')}}</span>
            <el-select  v-model="tgMsgTo" >
              <el-option
                  v-for="item in tgMsgToOption"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value"
              />
            </el-select>
          </div>
          <div class="tg-msg-label">
            <span>{{t('emailText')}}</span>
            <el-select  v-model="tgMsgText" >
              <el-option
                  v-for="item in tgMsgTextOption"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value"
              />
            </el-select>
          </div>
        </div>
        <template #footer>
          <div class="dialog-footer">
            <el-switch v-model="tgBotStatus" :active-value="0" :inactive-value="1" :active-text="$t('enable')"
                       :inactive-text="$t('disable')"/>
            <el-button :loading="settingLoading" type="primary" @click="tgBotSave">
              {{ $t('save') }}
            </el-button>
          </div>
        </template>
      </el-dialog>
      <el-dialog
          v-model="thirdEmailShow"
          class="forward-dialog"
      >
        <template #header>
          <div class="forward-head">
            <span class="forward-set-title">{{ $t('otherEmail') }}</span>
            <el-tooltip effect="dark" :content="$t('otherEmailDesc')">
              <Icon class="warning" icon="fe:warning" width="18" height="18"/>
            </el-tooltip>
          </div>
        </template>
        <div class="forward-set-body">
          <el-input-tag tag-type="warning" :placeholder="$t('otherEmailInputDesc')" v-model="forwardEmail"
                        @add-tag="emailAddTag"></el-input-tag>
        </div>
        <template #footer>
          <div class="dialog-footer">
            <el-switch v-model="forwardStatus" :active-value="0" :inactive-value="1" :active-text="$t('enable')"
                       :inactive-text="$t('disable')"/>
            <el-button :loading="settingLoading" type="primary" @click="forwardEmailSave">
              {{ $t('save') }}
            </el-button>
          </div>
        </template>
      </el-dialog>
      <el-dialog
          v-model="forwardRulesShow"
          class="forward-dialog"
      >
        <template #header>
          <div class="forward-head">
            <span class="forward-set-title">{{ $t('forwardingRules') }}</span>
            <el-tooltip effect="dark" :content="$t('forwardingRulesDesc')">
              <Icon class="warning" icon="fe:warning" width="18" height="18"/>
            </el-tooltip>
          </div>
        </template>
        <div class="forward-set-body">
          <el-input-tag :placeholder="$t('ruleEmailsInputDesc')" tag-type="success" v-model="ruleEmail"
                        @add-tag="ruleEmailAddTag"/>
        </div>
        <template #footer>
          <div class="dialog-footer">
            <el-radio-group v-model="ruleType">
              <el-radio :value="0">{{ $t('forwardAll') }}</el-radio>
              <el-radio :value="1">{{ $t('rules') }}</el-radio>
            </el-radio-group>
            <el-button :loading="settingLoading" type="primary" @click="ruleEmailSave">
              {{ $t('save') }}
            </el-button>
          </div>
        </template>
      </el-dialog>
      <el-dialog class="resend-table" v-model="showResendList" :title="$t('resendTokenList')">
        <el-table :data="resendList">
          <el-table-column :min-width="emailColumnWidth" property="key" :label="$t('domain')"
                           :show-overflow-tooltip="true"/>
          <el-table-column :width="tokenColumnWidth" property="value" label="Token" fixed="right"
                           :show-overflow-tooltip="true"/>
        </el-table>
      </el-dialog>
      <el-dialog v-model="regVerifyCountShow" :title="$t('rulesVerifyTitle',{count: regVerifyCount})"
                 @closed="regVerifyCount = setting.regVerifyCount">
        <form>
          <el-input-number type="text" v-model="regVerifyCount" :min="1">
          </el-input-number>
          <el-button type="primary" :loading="settingLoading" @click="saveRegVerifyCount">{{ $t('save') }}</el-button>
        </form>
      </el-dialog>
      <el-dialog v-model="addVerifyCountShow" :title="$t('rulesVerifyTitle',{count: addVerifyCount})"
                 @closed="addVerifyCount = setting.addVerifyCount">
        <form>
          <el-input-number type="text" v-model="addVerifyCount" :min="1"/>
          <el-button type="primary" :loading="settingLoading" @click="saveAddVerifyCount">{{ $t('save') }}</el-button>
        </form>
      </el-dialog>
      <el-dialog top="5vh" v-model="noticePopupShow" :title="$t('noticePopup')" class="notice-popup"
                 @closed="resetNoticeForm">
        <form>
          <el-input v-model="noticeForm.noticeTitle" :placeholder="t('titleDesc')"/>
          <div class="notice-line-item">
            <el-select v-model="noticeForm.noticeType">
              <template #prefix>
                <span style="margin-right: 10px">{{ $t('icon') }}</span>
              </template>
              <el-option key="none" label="None" value="none"/>
              <el-option key="primary" label="Primary" value="primary"/>
              <el-option key="success" label="Success" value="success"/>
              <el-option key="warning" label="Warning" value="warning"/>
              <el-option key="info" label="Info" value="info"/>
            </el-select>
            <el-select v-model="noticeForm.noticePosition">
              <template #prefix>
                <span style="margin-right: 10px">{{ $t('position') }}</span>
              </template>
              <el-option key="top-left" :label="t('topLeft')" value="top-left"/>
              <el-option key="top-right" :label="t('topRight')" value="top-right"/>
              <el-option key="bottom-left" :label="t('bottomLeft')" value="bottom-left"/>
              <el-option key="bottom-right" :label="t('bottomRight')" value="bottom-right"/>
            </el-select>
            <el-input-number v-model="noticeForm.noticeWidth">
              <template #prefix>
                {{ $t('width') }}
              </template>
              <template #suffix>
                px
              </template>
            </el-input-number>
            <el-input-number v-model="noticeForm.noticeOffset">
              <template #prefix>
                {{ $t('offset') }}
              </template>
              <template #suffix>
                px
              </template>
            </el-input-number>
            <el-input-number v-model="noticeForm.noticeDuration">
              <template #prefix>
                {{ $t('duration') }}
              </template>
              <template #suffix>
                ms
              </template>
            </el-input-number>
          </div>
          <div class="notice-popup-item">
            <el-input
                v-model="noticeForm.noticeContent"
                :autosize="{ minRows: 15, maxRows: 25 }"
                type="textarea"
                :placeholder="t('noticeContentDesc')"
            />
          </div>
        </form>
        <template #footer>
          <div class="dialog-footer">
            <el-switch v-model="noticeForm.notice" :active-value="0" :inactive-value="1" :active-text="$t('enable')"
                       :inactive-text="$t('disable')"/>
            <div>
              <el-button @click="previewNoticePopup">
                {{ $t('preview') }}
              </el-button>
              <el-button :loading="settingLoading" type="primary" @click="saveNoticePopup">
                {{ $t('save') }}
              </el-button>
            </div>
          </div>
        </template>
      </el-dialog>
      <el-dialog v-model="addS3Show" :title="t('s3Configuration')" width="340" @closed="resetAddS3Form">
        <form>
          <el-input class="dialog-input" type="text" placeholder="Bucket" v-model="s3.bucket"/>
          <el-input class="dialog-input" type="text" placeholder="Endpoint" v-model="s3.endpoint"/>
          <el-input class="dialog-input" type="text" placeholder="Region" v-model="s3.region"/>
          <el-input class="dialog-input" type="text" :placeholder="setting.s3AccessKey || 'Access Key'"
                    v-model="s3.s3AccessKey"/>
          <el-input style="margin-bottom: 10px" type="text" :placeholder="setting.s3SecretKey || 'Secret Key'" v-model="s3.s3SecretKey"/>
          <div class="force-path-style">
            <div class="force-path-style-left">
              <span>ForcePathStyle</span>
              <el-tooltip effect="dark" :content="$t('forcePathStyleDesc')">
                <Icon class="warning" icon="fe:warning" width="18" height="18"/>
              </el-tooltip>
            </div>
            <el-switch :before-change="beforeChange" :active-value="0" :inactive-value="1"
                       v-model="s3.forcePathStyle"/>
          </div>
          <div class="s3-button">
            <el-button :loading="clearS3Loading" @click="clearS3">{{ t('clear') }}</el-button>
            <el-button type="primary" :loading="settingLoading && !clearS3Loading" @click="saveS3">{{ t('save') }}</el-button>
          </div>
        </form>
      </el-dialog>
      <el-dialog v-model="emailPrefixShow" :title="t('emailPrefix')"  @closed="resetEmailPrefix"  >
        <div class="email-prefix">
          <div>{{ t('atLeast') }}</div>
          <el-input-number v-model="minEmailPrefix" :min="1" :max="20" style="width: 150px" >
            <template #suffix>
              <span>{{ t('character') }}</span>
            </template>
          </el-input-number>
        </div>
        <div class="prefix-filter">
          <div style="margin-bottom: 10px;">{{ t('mustNotContain') }}</div>
          <el-input-tag style="margin-bottom: 10px;" v-model="emailPrefixFilter" :placeholder="t('mustNotContainDesc')"  />
        </div>
        <el-button type="primary" style="width: 100%;" :loading="settingLoading" @click="saveEmailPrefix">{{ $t('save') }}</el-button>
      </el-dialog>
    </el-scrollbar>
  </div>
</template>

<script setup>
import {computed, defineOptions, reactive, ref, watch} from "vue";
import {deleteBackground, getMailcowServerDependencies, mailcowTestConnection, mailcowTestConnectionWithConfig, setBackground, settingQuery, settingSet} from "@/request/setting.js";
import {useSettingStore} from "@/store/setting.js";
import {useUiStore} from "@/store/ui.js";
import {useUserStore} from "@/store/user.js";
import {useAccountStore} from "@/store/account.js";
import {Icon} from "@iconify/vue";
import {cvtR2Url} from "@/utils/convert.js";
import {storeToRefs} from "pinia";
import {debounce} from 'lodash-es'
import {isEmail} from "@/utils/verify-utils.js";
import loading from "@/components/loading/index.vue";
import {getTextWidth} from "@/utils/text.js";
import {fileToBase64} from "@/utils/file-utils.js"
import {useI18n} from 'vue-i18n';
import axios from "axios";

defineOptions({
  name: 'sys-setting'
})

const currentVersion = 'v2.9.0'
const hasUpdate = ref(false)
let getUpdateErrorCount = 1;
const {t, locale} = useI18n();
const firstLoading = ref(true)
const backgroundImage = ref('')
const localUpShow = ref(false)
const accountStore = useAccountStore();
const userStore = useUserStore();
const editTitleShow = ref(false)
const resendTokenFormShow = ref(false)
const r2DomainShow = ref(false)
const turnstileShow = ref(false)
const tgSettingShow = ref(false)
const noticePopupShow = ref(false)
const thirdEmailShow = ref(false)
const forwardRulesShow = ref(false)
const emailPrefixShow = ref(false)
const mailcowConfigShow = ref(false)
const showResendList = ref(false)
const settingStore = useSettingStore();
const uiStore = useUiStore();
const {settings: setting} = storeToRefs(settingStore);
const editTitle = ref('')
const settingLoading = ref(false)
const clearS3Loading = ref(false)
const r2DomainInput = ref('')
const loginOpacity = ref(0)
const minEmailPrefix = ref(0)
const emailPrefixFilter = ref([])
const backgroundUrl = ref('')
let backgroundFile = {}
const showSetBackground = ref(false)
let regVerifyCount = ref(1)
let addVerifyCount = ref(1)
let backup = '{}'
const addS3Show = ref(false)
const addVerifyCountShow = ref(false)
const regVerifyCountShow = ref(false)
const resendTokenForm = reactive({
  domain: '',
  token: '',
})
const turnstileForm = reactive({
  siteKey: '',
  secretKey: ''
})

const s3 = reactive({
  bucket: '',
  endpoint: '',
  region: '',
  s3AccessKey: '',
  s3SecretKey: '',
  forcePathStyle: 1
})

const noticeForm = reactive({
  noticeTitle: '',
  noticeContent: '',
  noticeType: '',
  noticeDuration: '',
  noticePosition: '',
  noticeOffset: 0,
  notice: 0,
  noticeWidth: 0
})

const regKeyOptions = computed(() => [
  {label: t('enable'), value: 0},
  {label: t('disable'), value: 1},
  {label: t('optional'), value: 2},
])

const authRefreshOptions = computed(() => [
  {label: t('disable'), value: 0},
  {label: '3s', value: 3},
  {label: '5s', value: 5},
  {label: '10s', value: 10},
  {label: '15s', value: 15},
  {label: '20s', value: 20},
])

const tgChatId = ref([])
const customDomain = ref('')
const tgBotStatus = ref(0)
const tgBotToken = ref('')
const forwardEmail = ref([])
const forwardStatus = ref(0)
const emailColumnWidth = ref(0)
const tokenColumnWidth = ref(0)
const ruleType = ref(0)
const ruleEmail = ref([])
const tgMsgFrom = ref('')
const tgMsgTo = ref('')
const tgMsgText = ref('')

const tgMsgFromOption = [{label: t('show'), value: 'show'}, {label: t('hide'), value: 'hide'}, {label: t('onlyName'), value:'only-name'}]
const tgMsgToOption = [{label: t('show'), value: 'show'}, {label: t('hide'), value: 'hide'}]
const tgMsgTextOption = [{label: t('show'), value: 'show'}, {label: t('hide'), value: 'hide'}]
const tgMsgLabelWidth = computed(() => locale.value === 'en' ? '120px' : '100px');
const mailcowActiveTab = ref('global')
const mailcowAdvancedMode = ref(false)
const mailcowAdvancedShow = ref(false)
const mailcowAdvancedJson = ref('')
const mailcowServerFormShow = ref(false)
const mailcowServerFormType = ref('mailcow') // 'mailcow' or 'smtp'
const mailcowServerForm = ref({}) // current form data
const mailcowTestingAll = ref(false)

const smtpServerCount = computed(() => {
  const list = setting.value.smtpServers
  return Array.isArray(list) ? list.length : 0
})

// Reactive edit state - deep copy of settings for editing
const mailcowEdit = ref({
  passwordMode: 'random',
  provisionPassword: '',
  createStrict: 0,
  retryCount: 3,
  timeout: 30000,
  globalSmtpTemplate: {},
  servers: [],
  smtpServers: []
})

const mailcowServerCount = computed(() => {
  const list = setting.value.mailcowServers
  return Array.isArray(list) ? list.length : 0
})

getSettings()
getUpdate()

function getSettings() {
  settingQuery().then(settingData => {
    if (settingData.mailcowEnabled === undefined) {
      settingData.mailcowEnabled = 0
    }
    if (!Array.isArray(settingData.mailcowServers)) {
      settingData.mailcowServers = []
    }
    if (settingData.mailcowRetryCount === undefined) {
      settingData.mailcowRetryCount = 3
    }
    if (settingData.mailcowTimeout === undefined) {
      settingData.mailcowTimeout = 30000
    }
    if (!Array.isArray(settingData.smtpServers)) {
      settingData.smtpServers = []
    }
    if (!Array.isArray(settingData.loginDomains)) {
      settingData.loginDomains = []
    }
    if (settingData.mailcowPasswordMode === undefined) {
      settingData.mailcowPasswordMode = 'random'
    }
    if (settingData.mailcowCreateStrict === undefined) {
      settingData.mailcowCreateStrict = 0
    }
    if (!settingData.mailcowGlobalSmtpTemplate || typeof settingData.mailcowGlobalSmtpTemplate !== 'object') {
      settingData.mailcowGlobalSmtpTemplate = {}
    }

    setting.value = settingData
    settingStore.domainList = settingData.domainList;
    resendTokenForm.domain = setting.value.domainList[0]
    loginOpacity.value = setting.value.loginOpacity
    minEmailPrefix.value = setting.value.minEmailPrefix
    firstLoading.value = false
    backgroundUrl.value = setting.value.background?.startsWith('http') ? setting.value.background : ''
    editTitle.value = setting.value.title
    r2DomainInput.value = setting.value.r2Domain
    addVerifyCount.value = setting.value.addVerifyCount
    regVerifyCount.value = setting.value.regVerifyCount
    resetNoticeForm()
    resetAddS3Form()
    resetEmailPrefix()
  })
}


function openNoticePopup() {
  uiStore.showNotice()
}

function resetMailcowConfig() {
  const s = setting.value
  mailcowActiveTab.value = 'global'
  mailcowAdvancedMode.value = false
  mailcowEdit.value = {
    passwordMode: s.mailcowPasswordMode || 'random',
    provisionPassword: '',
    createStrict: s.mailcowCreateStrict ?? 0,
    retryCount: s.mailcowRetryCount ?? 3,
    timeout: s.mailcowTimeout ?? 30000,
    globalSmtpTemplate: { ...(s.mailcowGlobalSmtpTemplate || {}) },
    servers: (Array.isArray(s.mailcowServers) ? s.mailcowServers : []).map(srv => ({ ...srv, _testResult: null, _testing: false })),
    smtpServers: (Array.isArray(s.smtpServers) ? s.smtpServers : []).map(srv => ({ ...srv }))
  }
}

function openMailcowConfig() {
  if (settingLoading.value) return
  resetMailcowConfig()
  mailcowConfigShow.value = true
}

// Mailcow server CRUD
function addMailcowServer() {
  mailcowServerFormType.value = 'mailcow'
  mailcowServerForm.value = {
    id: 'mc-' + Date.now(),
    name: '',
    apiUrl: '',
    apiKey: '',
    smtpServerId: '',
    smtpHost: '',
    smtpPort: null,
    smtpSecure: 0,
    smtpAuthType: 'plain',
    isDefault: mailcowEdit.value.servers.length === 0,
    _editIndex: -1,
    _dependencies: 0
  }
  mailcowServerFormShow.value = true
}

function editMailcowServer(index) {
  const server = mailcowEdit.value.servers[index]
  mailcowServerFormType.value = 'mailcow'
  mailcowServerForm.value = {
    ...server,
    apiKey: '', // Don't show current key
    _editIndex: index,
    _dependencies: 0
  }
  // Fetch dependencies
  if (server.id) {
    getMailcowServerDependencies(server.id).then(res => {
      mailcowServerForm.value._dependencies = res.count || 0
    }).catch(() => {})
  }
  mailcowServerFormShow.value = true
}

async function deleteMailcowServer(index) {
  const server = mailcowEdit.value.servers[index]
  let deps = 0
  try {
    const res = await getMailcowServerDependencies(server.id)
    deps = res.count || 0
  } catch (e) {}
  
  if (deps > 0) {
    ElMessage({
      message: `此服务器已绑定 ${deps} 个账户，请先迁移绑定后再删除`,
      type: 'warning',
      plain: true
    })
    return
  }

  await ElMessageBox.confirm(`确认删除服务器 "${server.name}"?`, '确认删除')
  
  mailcowEdit.value.servers.splice(index, 1)
}

async function testMailcowServerConnection(index) {
  const server = mailcowEdit.value.servers[index]
  server._testing = true
  try {
    const hasRawApiKey = typeof server.apiKey === 'string' && server.apiKey.length > 0 && !server.apiKey.includes('****')
    const res = hasRawApiKey
      ? await mailcowTestConnectionWithConfig({
          apiUrl: server.apiUrl,
          apiKey: server.apiKey
        })
      : await mailcowTestConnection(server.id)
    server._testResult = { success: true, duration: res.duration }
    ElMessage({ message: `${server.name}: 连接成功 (${res.duration}ms)`, type: 'success', plain: true })
  } catch (e) {
    server._testResult = { success: false, error: e?.message }
    ElMessage({ message: `${server.name}: ${e?.message || '连接失败'}`, type: 'error', plain: true })
  } finally {
    server._testing = false
  }
}

async function testAllMailcowConnections() {
  mailcowTestingAll.value = true
  for (let i = 0; i < mailcowEdit.value.servers.length; i++) {
    await testMailcowServerConnection(i)
  }
  mailcowTestingAll.value = false
}

// SMTP Server CRUD
function addSmtpServer() {
  mailcowServerFormType.value = 'smtp'
  mailcowServerForm.value = {
    name: '',
    smtpHost: '',
    smtpPort: 587,
    smtpSecure: 0,
    smtpAuthType: 'plain',
    isDefault: mailcowEdit.value.smtpServers.length === 0,
    _editIndex: -1
  }
  mailcowServerFormShow.value = true
}

function editSmtpServer(index) {
  const server = mailcowEdit.value.smtpServers[index]
  mailcowServerFormType.value = 'smtp'
  mailcowServerForm.value = { ...server, _editIndex: index }
  mailcowServerFormShow.value = true
}

function deleteSmtpServer(index) {
  ElMessageBox.confirm(`确认删除 SMTP 服务器 "${mailcowEdit.value.smtpServers[index].name}"?`, '确认删除')
    .then(() => mailcowEdit.value.smtpServers.splice(index, 1))
}

function saveMailcowServerForm() {
  const form = mailcowServerForm.value
  const type = mailcowServerFormType.value
  
  // Validation
  if (!form.name) { ElMessage.error('名称不能为空'); return }
  if (type === 'mailcow' && !form.apiUrl) { ElMessage.error('API 地址不能为空'); return }
  if (type === 'mailcow' && form._editIndex < 0 && !form.apiKey) { ElMessage.error('API Key 不能为空'); return }
  if (type === 'smtp' && !form.smtpHost) { ElMessage.error('SMTP 主机不能为空'); return }
  
  const list = type === 'mailcow' ? mailcowEdit.value.servers : mailcowEdit.value.smtpServers
  
  // Handle default - only one default allowed
  if (form.isDefault) {
    list.forEach(s => s.isDefault = false)
  }
  
  const serverData = { ...form }
  delete serverData._editIndex
  delete serverData._dependencies
  delete serverData._testResult
  delete serverData._testing
  
  if (form._editIndex >= 0) {
    if (type === 'mailcow' && !form.apiKey) {
      delete serverData.apiKey
    }
    // Preserve test result
    serverData._testResult = list[form._editIndex]._testResult
    list[form._editIndex] = serverData
  } else {
    list.push(serverData)
  }
  
  mailcowServerFormShow.value = false
}

// Save all mailcow config
function saveMailcowConfig() {
  const edit = mailcowEdit.value
  
  const form = {
    mailcowPasswordMode: edit.passwordMode,
    mailcowCreateStrict: Number(edit.createStrict || 0),
    mailcowRetryCount: Number(edit.retryCount || 3),
    mailcowTimeout: Number(edit.timeout || 30000),
    mailcowGlobalSmtpTemplate: edit.globalSmtpTemplate,
    mailcowServers: edit.servers.map(s => {
      const copy = { ...s }
      delete copy._testResult
      delete copy._testing
      return copy
    }),
    smtpServers: edit.smtpServers.map(s => ({ ...s }))
  }
  
  if (edit.passwordMode === 'fixed' && edit.provisionPassword) {
    form.mailcowProvisionPassword = edit.provisionPassword
  }
  
  // Validate defaults
  if (form.mailcowServers.length > 0 && !form.mailcowServers.some(s => s.isDefault)) {
    ElMessage.error('Mailcow 服务器列表中必须有一个默认服务器')
    return
  }
  if (form.smtpServers.length > 0 && !form.smtpServers.some(s => s.isDefault)) {
    ElMessage.error('SMTP 服务器列表中必须有一个默认服务器')
    return
  }
  
  editSetting(form)
}

// Advanced mode
function exportMailcowJson() {
  const edit = mailcowEdit.value
  mailcowAdvancedJson.value = JSON.stringify({
    mailcowPasswordMode: edit.passwordMode,
    mailcowCreateStrict: edit.createStrict,
    mailcowRetryCount: edit.retryCount,
    mailcowTimeout: edit.timeout,
    mailcowGlobalSmtpTemplate: edit.globalSmtpTemplate,
    mailcowServers: edit.servers.map(s => {
      const copy = { ...s }
      delete copy._testResult
      delete copy._testing
      return copy
    }),
    smtpServers: edit.smtpServers
  }, null, 2)
}

function importMailcowJson() {
  try {
    const parsed = JSON.parse(mailcowAdvancedJson.value)
    const errors = []
    
    if (parsed.mailcowServers && !Array.isArray(parsed.mailcowServers)) {
      errors.push('mailcowServers 必须是数组')
    } else if (Array.isArray(parsed.mailcowServers)) {
      parsed.mailcowServers.forEach((s, i) => {
        if (!s.name) errors.push(`mailcowServers[${i}]: 缺少 name`)
        if (!s.apiUrl) errors.push(`mailcowServers[${i}]: 缺少 apiUrl`)
      })
    }
    if (parsed.smtpServers && !Array.isArray(parsed.smtpServers)) {
      errors.push('smtpServers 必须是数组')
    } else if (Array.isArray(parsed.smtpServers)) {
      parsed.smtpServers.forEach((s, i) => {
        if (!s.name) errors.push(`smtpServers[${i}]: 缺少 name`)
        if (!s.smtpHost) errors.push(`smtpServers[${i}]: 缺少 smtpHost`)
      })
    }
    
    if (errors.length > 0) {
      ElMessage({ message: errors.join('\n'), type: 'error', plain: true, duration: 5000 })
      return
    }
    
    // Apply to edit form
    mailcowEdit.value = {
      passwordMode: parsed.mailcowPasswordMode || mailcowEdit.value.passwordMode,
      provisionPassword: '',
      createStrict: parsed.mailcowCreateStrict ?? mailcowEdit.value.createStrict,
      retryCount: parsed.mailcowRetryCount ?? mailcowEdit.value.retryCount,
      timeout: parsed.mailcowTimeout ?? mailcowEdit.value.timeout,
      globalSmtpTemplate: parsed.mailcowGlobalSmtpTemplate || {},
      servers: (parsed.mailcowServers || []).map(s => ({ ...s, _testResult: null, _testing: false })),
      smtpServers: parsed.smtpServers || []
    }
    
    ElMessage({ message: '导入成功', type: 'success', plain: true })
    mailcowAdvancedShow.value = false
  } catch (e) {
    ElMessage({ message: 'JSON 解析失败: ' + e.message, type: 'error', plain: true })
  }
}

// Watch for advanced mode toggle
watch(mailcowAdvancedMode, (val) => {
  if (val) {
    exportMailcowJson()
    mailcowAdvancedShow.value = true
    mailcowAdvancedMode.value = false // reset toggle
  }
})

// Computed for dialog title
const mailcowServerFormTitle = computed(() => {
  const type = mailcowServerFormType.value
  const idx = mailcowServerForm.value._editIndex
  if (type === 'mailcow') {
    return idx >= 0 ? '编辑 Mailcow 服务器' : '添加 Mailcow 服务器'
  } else {
    return idx >= 0 ? '编辑 SMTP 服务器' : '添加 SMTP 服务器'
  }
})

function openAddVerifyCount() {
  if (settingLoading.value) return
  addVerifyCountShow.value = true
}

function openRegVerifyCount() {
  if (settingLoading.value) return
  regVerifyCountShow.value = true
}

function resetAddS3Form() {
  s3.bucket = setting.value.bucket
  s3.endpoint = setting.value.endpoint
  s3.region = setting.value.region
  s3.s3AccessKey = ''
  s3.s3SecretKey = ''
  s3.forcePathStyle = setting.value.forcePathStyle
}

const resendList = computed(() => {

  let list = Object.keys(setting.value.resendTokens).map(key => {
    return {
      key: key,
      value: setting.value.resendTokens[key]
    };
  })

  if (list.length > 0) {

    const key = list.reduce((a, b) => compareByLengthAndUpperCase(a, b, 'key')).key;
    emailColumnWidth.value = getTextWidth(key) + 30;

    const value = list.reduce((a, b) => compareByLengthAndUpperCase(a, b, 'value')).value;
    tokenColumnWidth.value = getTextWidth(value) + 30;

  }

  return list;
});

function getUpdate() {
  if (getUpdateErrorCount > 5 || !getUpdateErrorCount) return
  axios.get('https://api.github.com/repos/maillab/cloud-mail/releases/latest').then(({data}) => {
    hasUpdate.value = data.name !== currentVersion
    getUpdateErrorCount = 0
  }).catch(e => {
    getUpdateErrorCount++
    setTimeout(() => {
      getUpdate()
    }, 2000)
    console.error('检查更新失败：', e)
  })
}

function saveAddVerifyCount() {
  if (!addVerifyCount.value) {
    addVerifyCount.value = 1
  }
  editSetting({addVerifyCount: addVerifyCount.value})
}

function saveRegVerifyCount() {
  if (!regVerifyCount.value) {
    regVerifyCount.value = 1
  }
  editSetting({regVerifyCount: regVerifyCount.value})
}

const compareByLengthAndUpperCase = (a, b, key) => {
  const getUpperCaseCount = (str) => (str.match(/[A-Z]/g) || []).length;
  if (a[key].length === b[key].length) {
    return getUpperCaseCount(a[key]) > getUpperCaseCount(b[key]) ? a : b;
  }
  return a[key].length > b[key].length ? a : b;
};


function closedSetBackground() {
  backgroundImage.value = ''
  localUpShow.value = false
  backgroundUrl.value = setting.value.background?.startsWith('http') ? setting.value.background : ''
}

function openTgSetting() {
  tgBotStatus.value = setting.value.tgBotStatus
  tgBotToken.value = setting.value.tgBotToken
  customDomain.value = setting.value.customDomain
  tgMsgFrom.value = setting.value.tgMsgFrom
  tgMsgText.value = setting.value.tgMsgText
  tgMsgTo.value = setting.value.tgMsgTo
  tgChatId.value = []
  if (setting.value.tgChatId) {
    const list = setting.value.tgChatId.split(',')
    tgChatId.value.push(...list)
  }
  tgSettingShow.value = true
}

function openNoticePopupSetting() {
  noticePopupShow.value = true
}

function openResendList() {
  if (Number(setting.value.resendEnabled) !== 1) return
  showResendList.value = true
}

function resetNoticeForm() {
  noticeForm.notice = setting.value.notice
  noticeForm.noticeContent = setting.value.noticeContent
  noticeForm.noticeDuration = setting.value.noticeDuration
  noticeForm.noticeTitle = setting.value.noticeTitle
  noticeForm.noticePosition = setting.value.noticePosition
  noticeForm.noticeType = setting.value.noticeType
  noticeForm.noticeOffset = setting.value.noticeOffset
  noticeForm.noticeWidth = setting.value.noticeWidth
}

function saveNoticePopup() {
  noticeForm.noticeOffset = noticeForm.noticeOffset || 0
  noticeForm.noticeWidth = noticeForm.noticeWidth || 0
  noticeForm.noticeDuration = noticeForm.noticeDuration || 0
  editSetting({...noticeForm})
}

function previewNoticePopup() {
  uiStore.previewNotice({...noticeForm})
}

function openThirdEmailSetting() {
  forwardEmail.value = []
  forwardStatus.value = setting.value.forwardStatus
  if (setting.value.forwardEmail) {
    const list = setting.value.forwardEmail.split(',')
    forwardEmail.value.push(...list)
  }
  thirdEmailShow.value = true
}

function openEmailPrefix() {
  emailPrefixShow.value = true
}

function openForwardRules() {
  ruleType.value = setting.value.ruleType
  ruleEmail.value = []
  if (setting.value.ruleEmail) {
    const list = setting.value.ruleEmail.split(',')
    ruleEmail.value.push(...list)
  }
  forwardRulesShow.value = true
}

function emailAddTag(val) {
  const emails = Array.from(new Set(
      val.split(/[,，]/).map(item => item.trim()).filter(item => item)
  ));

  forwardEmail.value.splice(forwardEmail.value.length - 1, 1)

  emails.forEach(email => {
    if (isEmail(email) && !forwardEmail.value.includes(email)) {
      forwardEmail.value.push(email)
    }
  })
}

function ruleEmailAddTag(val) {
  const emails = Array.from(new Set(
      val.split(/[,，]/).map(item => item.trim()).filter(item => item)
  ));

  ruleEmail.value.splice(ruleEmail.value.length - 1, 1)

  emails.forEach(email => {
    if (isEmail(email) && !ruleEmail.value.includes(email)) {
      ruleEmail.value.push(email)
    }
  })
}

function addChatTag(val) {

  const chatIds = Array.from(new Set(
      val.split(/[,，]/).map(item => item.trim()).filter(item => item)
  ));

  tgChatId.value.splice(tgChatId.value.length - 1, 1)

  chatIds.forEach(id => {
    if (!isNaN(Number(id))) {
      tgChatId.value.push(id)
    }
  })
}

function clearS3() {

  const form = {
    bucket: '',
    endpoint: '',
    region: '',
    s3AccessKey: '',
    s3SecretKey: '',
    forcePathStyle: 1
  }
  clearS3Loading.value = true
  editSetting(form)
}

function saveS3() {

  const form = {
    bucket: s3.bucket,
    endpoint: s3.endpoint,
    region: s3.region,
    forcePathStyle: s3.forcePathStyle
  }

  if (s3.s3AccessKey) form.s3AccessKey = s3.s3AccessKey
  if (s3.s3SecretKey) form.s3SecretKey = s3.s3SecretKey

  editSetting(form)
}

function tgBotSave() {
  const form = {
    tgBotToken: tgBotToken.value,
    customDomain: customDomain.value,
    tgBotStatus: tgBotStatus.value,
    tgChatId: tgChatId.value + '',
    tgMsgFrom: tgMsgFrom.value,
    tgMsgText: tgMsgText.value,
    tgMsgTo: tgMsgTo.value
  }
  editSetting(form)
}

function forwardEmailSave() {
  const form = {
    forwardStatus: forwardStatus.value,
    forwardEmail: forwardEmail.value + ''
  }
  editSetting(form)
}


function ruleEmailSave() {
  const form = {
    ruleEmail: ruleEmail.value + '',
    ruleType: ruleType.value
  }
  editSetting(form)
}

function doOpacityChange() {
  const form = {}
  form.loginOpacity = loginOpacity.value
  editSetting(form, true)
}

function resetEmailPrefix() {
  minEmailPrefix.value = setting.value.minEmailPrefix
  emailPrefixFilter.value = setting.value.emailPrefixFilter
}

function saveEmailPrefix() {
  const form = {}
  form.minEmailPrefix = minEmailPrefix.value
  form.emailPrefixFilter = emailPrefixFilter.value
  editSetting(form, true)
}

function saveLoginDomains() {
  editSetting({ loginDomains: setting.value.loginDomains }, true)
}

const opacityChange = debounce(doOpacityChange, 1000, {
  leading: false,
  trailing: true
})

function delBackground() {
  ElMessageBox.confirm(t('delBackgroundConfirm'), {
    confirmButtonText: t('confirm'),
    cancelButtonText: t('cancel'),
    type: 'warning'
  }).then(() => {
    deleteBackground().then(() => {
      backgroundUrl.value = ''
      setting.value.background = null
      ElMessage({
        message: t('delSuccessMsg'),
        type: "success",
        plain: true
      })
    })
  })
}

function saveTurnstileKey() {
  const settingForm = {}
  settingForm.siteKey = turnstileForm.siteKey
  settingForm.secretKey = turnstileForm.secretKey
  editSetting(settingForm)
}

async function saveBackground() {

  let image = ''

  if (localUpShow.value) {
    image = await fileToBase64(backgroundFile, true);
  } else {
    if (backgroundUrl.value && !backgroundUrl.value.startsWith('http')) {
      ElMessage({
        message: t('imageLinkErrorMsg'),
        type: "error",
        plain: true
      })
      return
    }
    image = backgroundUrl.value
  }
  settingLoading.value = true

  setBackground(image).then(key => {
    setting.value.background = key
    showSetBackground.value = false
    ElMessage({
      message: t('saveSuccessMsg'),
      type: "success",
      plain: true
    })
    localUpShow.value = false
    backgroundImage.value = ''
  }).finally(() => {
    settingLoading.value = false
  })

}

function openSetBackground() {
  showSetBackground.value = true
}

function openCut() {
  const doc = document.createElement('input')
  doc.setAttribute('type', 'file')
  doc.setAttribute('accept', 'image/*')
  doc.click()
  doc.onchange = async (e) => {
    backgroundFile = e.target.files[0]
    backgroundImage.value = URL.createObjectURL(e.target.files[0])
    localUpShow.value = true
  }
}

function saveR2domain() {
  const settingForm = {r2Domain: r2DomainInput.value}
  editSetting(settingForm)
}

function openResendForm() {
  if (Number(setting.value.resendEnabled) !== 1) return
  resendTokenFormShow.value = true
}

function saveResendToken() {
  const settingForm = {
    resendTokens: {}
  }
  const domain = resendTokenForm.domain.slice(1)
  settingForm.resendTokens[domain] = resendTokenForm.token
  editSetting(settingForm)
}

function backupSetting() {
  const settingForm = {...setting.value}
  delete settingForm.resendTokens
  delete settingForm.siteKey
  delete settingForm.secretKey
  backup = JSON.stringify(setting.value)
}

function cleanResendTokenForm() {
  resendTokenForm.token = ''
}

function beforeChange() {
  if (settingLoading.value) return false
  backupSetting()
  return true
}

function change(e) {
  if (Number(setting.value.resendEnabled) !== 1) {
    showResendList.value = false
    resendTokenFormShow.value = false
  }
  const settingForm = {...setting.value}
  delete settingForm.siteKey
  delete settingForm.secretKey
  delete settingForm.s3AccessKey
  delete settingForm.s3SecretKey
  delete settingForm.resendTokens
  editSetting(settingForm, false)
}

function saveTitle() {
  editSetting({title: editTitle.value})
}

function jump(href) {
  const doc = document.createElement('a')
  doc.href = href
  doc.target = '_blank'
  doc.click()
}



function editSetting(settingForm, refreshStatus = true) {
  if (settingLoading.value) return
  settingLoading.value = true

  settingSet(settingForm).then(() => {
    settingLoading.value = false
    ElMessage({
      message: t('saveSuccessMsg'),
      type: "success",
      plain: true
    })
    if (setting.value.manyEmail === 1) {
      accountStore.currentAccountId = userStore.user.account.accountId;
    }
    if (refreshStatus) {
      getSettings()
    }
    editTitleShow.value = false
    r2DomainShow.value = false
    resendTokenFormShow.value = false
    turnstileShow.value = false
    tgSettingShow.value = false
    mailcowConfigShow.value = false
    thirdEmailShow.value = false
    forwardRulesShow.value = false
    addVerifyCountShow.value = false
    regVerifyCountShow.value = false
    noticePopupShow.value = false
    addS3Show.value = false
    emailPrefixShow.value = false
  }).catch((e) => {
    loginOpacity.value = setting.value.loginOpacity
    setting.value = {...setting.value, ...JSON.parse(backup)}
  }).finally(() => {
    settingLoading.value = false
    clearS3Loading.value = false
  })
}
</script>

<style scoped lang="scss">
.settings-container {
  height: 100%;
  overflow: hidden;
  background: var(--extra-light-fill) !important;
  position: relative;

  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    z-index: 2;
    width: 100%;
    position: absolute;
    top: 0;
    left: 0;
  }

  .loading-show {
    transition: all 200ms ease 200ms;
    opacity: 1;
  }

  .loading-hide {
    transition: var(--loading-hide-transition);
    pointer-events: none;
    opacity: 0;
  }
}

.scroll {
  width: 100%;
  min-height: 100%;

  :deep(.el-scrollbar__view) {
    height: 100%;
  }

  .scroll-body {
    min-height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
}

.card-grid {

  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
  padding: 20px;
  gap: 20px;
  @media (max-width: 500px) {
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  }
  @media (max-width: 1023px) {
    gap: 15px;
    padding: 15px;
  }
}

.background {
  width: 249px;
  height: 140px;
  border-radius: 4px;
  border: 1px solid var(--light-border);
  @media (max-width: 500px) {
    width: 160px;
    height: 90px;
  }
}

.background-btn {
  display: flex;
  gap: 10px;
  flex-direction: column;
}

.bot-verify-select {
  margin-left: 10px;
}

.settings-card {
  background-color: var(--el-bg-color);
  border-radius: 8px;
  border: 1px solid var(--el-border-color);
  transition: all 300ms;
  overflow: hidden;
}


.card-title {
  font-size: 15px;
  font-weight: bold;
  padding: 10px 20px;
  border-bottom: 1px solid var(--el-border-color);
}

.card-content {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.setting-item {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 10px;
  font-weight: normal;

  > div:first-child {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  > div:last-child {
    display: grid;
    grid-template-columns: 1fr auto;
    justify-items: flex-end;
    font-weight: normal;
  }
}

.r2domain-item {
  display: flex;
  gap: 10px;
  > div:first-child {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  > div:last-child {
    flex: 1;
    text-align: right;
  }
}

.title-icon.warning {
  position: relative;
  top: 2px;
  cursor: pointer;
  margin-left: 2px;
}

.warning {
  margin-left: 2px;
  color: grey;
  cursor: pointer;
}

.cropper {
  border-radius: 4px;
  border: 1px solid #D4D7DE;
  height: 397px;
  width: 705px;
  @media (max-width: 767px) {
    width: calc(100vw - 60px);
    height: calc((100vw - 60px) * 9 / 16);
  }
}

.dialog-footer {
  display: flex;
  justify-content: space-between;
}

.notice-popup-item {
  margin-top: 15px;
}

.notice-line-item {
  margin-top: 15px;
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 15px;

  > * {
    width: 100%;
  }

  @media (max-width: 840px) {
    grid-template-columns: 1fr 1fr;
  }
  @media (max-width: 580px) {
    grid-template-columns: 1fr;
  }
}

.background-url {
  width: min(calc(100vw - 70px), 500px);
}


:deep(.el-dialog) {
  width: 400px !important;
  @media (max-width: 440px) {
    width: calc(100% - 40px) !important;
    margin-right: 20px !important;
    margin-left: 20px !important;
  }
}

:deep(.resend-table.el-dialog) {
  min-height: 300px;
  width: 500px !important;
  @media (max-width: 540px) {
    width: calc(100% - 40px) !important;
    margin-right: 20px !important;
    margin-left: 20px !important;
  }
}

:deep(.notice-popup.el-dialog) {
  min-height: 300px;
  width: 820px !important;
  @media (max-width: 860px) {
    width: calc(100% - 40px) !important;
    margin-right: 20px !important;
    margin-left: 20px !important;
  }
}

:deep(.resend-table .el-dialog__header) {
  padding-bottom: 5px;
}

:deep(.el-table__inner-wrapper:before) {
  background: var(--el-bg-color);
}

:deep(.cut-dialog.el-dialog) {
  width: fit-content !important;
  height: fit-content !important;
}


:deep(.forward-dialog.el-dialog) {
  width: 500px !important;
  @media (max-width: 540px) {
    width: calc(100% - 40px) !important;
    margin-right: 20px !important;
    margin-left: 20px !important;
  }
}

.forward-dialog {
  .forward-head {
    display: flex;
    align-items: center;

    .forward-set-title {
      top: 1px;
      padding-right: 5px;
      position: relative;
      font-size: 16px;
      font-weight: bold;;
    }
  }
}

.error-image {
  background: var(--light-ill);
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.cut-button {
  padding-top: 15px;
  width: 100%;
  display: flex;
  justify-content: space-between;

  .el-button {
    width: fit-content;
  }
}

.bot-verify {
  display: grid;
  grid-template-columns: 1fr auto;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;

  span {
    display: flex;
    align-items: center;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .el-button {
    width: 48px;
    margin: 0 0 0 10px;
  }
}

.forward-set-body {
  display: flex;
  flex-direction: column;

  .el-switch {
    align-self: end;
  }

  > *:nth-child(-n+2) {
    margin-bottom: 15px;
  }

  .tg-msg-label {
    margin-top: 10px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    .el-select {
      width: v-bind(tgMsgLabelWidth);
    }
  }
}

.forward {
  span {
    display: flex;
    align-items: center;
  }

  .el-button {
    width: 48px;
    margin: 0 0 0 10px;
  }
}

.opt-button {
  width: fit-content !important;
}

.email-prefix {
  display: flex;
  justify-content: space-between;
}

.prefix-filter {
  display: flex;
  flex-direction: column;
}

.s3-button {
  display: grid;
  grid-template-columns: 80px 1fr;
  gap: 15px;

  .el-button {
    margin-left: 0;
  }
}

.r2domain {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;

  .storage-type {
    margin-right: 3px;
  }

  span {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .el-button {
    width: 48px;
    margin: 0 0 0 10px;
  }
}

.personalized {
  align-items: start;

  > div:last-child {
    display: flex;
    justify-content: end;

    .el-button {
      margin-left: 10px;
      margin-top: 0;
    }
  }
}

.dialog-input {
  margin-bottom: 15px;
}

.force-path-style {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  .force-path-style-left {
    padding-left: 2px;
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 5px;
  }
}

.concerning-item {
  display: flex;
  align-items: center;

  .community {
    display: flex;
    row-gap: 10px;
    flex-wrap: wrap;
  }

  :deep(.el-button) {
    padding: 0 10px;
    font-weight: normal;

    i {
      font-size: 22px;
    }
  }

  > span:first-child {
    font-weight: normal;
    padding-right: 20px;
    white-space: nowrap;
  }
}

.email-title {
  font-weight: normal !important;
  display: grid;
  gap: 10px;
  grid-template-columns: 1fr auto;
  align-items: center;

  span {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .el-button {
    margin-top: 0;
  }
}

.token-item {
  padding-top: 0;

  div:last-child {
    font-weight: normal;
  }
}

form .el-button {
  margin-top: 10px;
  width: 100%;
}

.el-switch {
  height: 28px;
}


:deep(.el-button--small) {
  margin-top: 2px !important;
  margin-bottom: 2px !important;
  height: 24px;
}

:deep(.el-select__wrapper) {
  min-height: 28px;
}

// Mailcow Config Center styles
.mailcow-form {
  .el-form-item {
    margin-bottom: 12px;
  }
  .form-hint {
    color: var(--el-text-color-secondary);
    font-size: 12px;
    margin-left: 10px;
  }
}

.smtp-template-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 15px;
}

.server-toolbar {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
}

.server-table {
  width: 100%;
}

.mailcow-dialog-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.advanced-actions {
  display: flex;
  gap: 10px;
  margin-top: 10px;
}

:deep(.mailcow-config-dialog.el-dialog) {
  width: 700px !important;
  @media (max-width: 740px) {
    width: calc(100% - 40px) !important;
  }
}

</style>

<style>
.el-popper.is-dark {
}
</style>
