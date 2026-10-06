<template>
  <div class="settings-layout">
    <!-- 左侧选项卡 -->
    <nav class="settings-nav">
      <!-- 「设置」字样同一行最右端：保存按钮（未修改时禁用） -->
      <div class="nav-head">
        <span class="nav-title">设置</span>
        <button
          class="btn btn-sm save-btn"
          :disabled="!dirty"
          :title="dirty ? '保存全部设置' : '没有需要保存的更改'"
          @click="saveAll"
        >
          <MdIcon name="save" :size="14" /> 保存
        </button>
      </div>
      <!-- 纵向选项卡：改用 MdTabs -->
      <MdTabs v-model="activeTab" :tabs="navTabs" orientation="vertical" fill class="nav-tabs" />

      <!-- 底部：保存状态与快捷操作（始终吸底） -->
      <div class="nav-foot">
        <div class="save-state" :class="{ dirty }">
          <MdIcon :name="dirty ? 'warning' : 'check'" :size="14" />
          <span>{{ dirty ? '有未保存的更改' : '所有更改已保存' }}</span>
        </div>
        <div class="row" style="gap: 6px">
          <button class="btn btn-text btn-sm" :disabled="!dirty" @click="resetDraft">撤销</button>
          <button class="btn btn-sm" style="flex: 1" :disabled="!dirty" @click="saveAll">
            <MdIcon name="save" :size="14" /> 保存设置
          </button>
        </div>
      </div>
    </nav>

    <!-- 右侧内容 -->
    <div class="settings-content view-enter" :key="activeTab">
      <!-- Tab: 下载 -->
      <template v-if="activeTab === 'download'">
        <section class="card">
          <h4 class="sec-title">下载偏好</h4>
          <div class="grid2">
            <div class="field">
              <span class="label">默认下载内容</span>
              <MdSelect v-model="s.content" :options="contentOptions" />
            </div>
            <div class="field">
              <span class="label">默认画质</span>
              <MdSelect v-model="s.quality" :options="qualityOptions" />
            </div>
            <div class="field">
              <span class="label">最大并行任务数</span>
              <input v-model.number="s.concurrent" type="number" min="1" max="8" class="input" />
            </div>
            <div class="field">
              <span class="label">全局限速（如 1M / 500K，留空不限）</span>
              <input v-model="s.rateLimit" class="input" placeholder="例如 1M" />
            </div>
          </div>
        </section>

        <section class="card">
          <h4 class="sec-title">下载目录模式</h4>
          <div class="field">
            <div class="seg">
              <button
                v-for="m in folderModes"
                :key="m.value"
                class="seg-btn"
                :class="{ active: s.folderMode === m.value }"
                @click="s.folderMode = m.value"
                :title="m.desc"
              >
                {{ m.label }}
              </button>
            </div>
            <div class="hint" v-if="s.folderMode === 'flat'">
              同目录：所有文件直接放入目标目录，<strong>不创建任何子文件夹</strong>（命名模板中不允许出现 <code>/</code>）
            </div>
            <div class="hint" v-else-if="s.folderMode === 'uploader'">作者隔离：按 UP 主名字建立一层文件夹（此模式允许命名模板再带 <code>/</code>）</div>
            <div class="hint" v-else>自定义：用目录模板自由控制子目录层级（允许 <code>/</code>）</div>
            <input
              v-if="s.folderMode === 'custom'"
              v-model="s.customFolderTemplate"
              class="input mono"
              style="margin-top: 6px"
              placeholder="{uploader}/{favName}"
            />
            <template v-if="s.folderMode === 'custom'">
              <div v-for="(issue, i) in folderIssues" :key="'fi' + i" class="tpl-msg" :class="issue.level">
                <MdIcon :name="issue.level === 'error' ? 'warning' : 'info'" :size="14" />
                <span>{{ issue.message }}</span>
              </div>
              <div class="doc">
                <div class="doc-title">目录模板占位符</div>
                <div class="doc-row" v-for="p in folderPlaceholders" :key="p.token">
                  <code>{{ p.token }}</code>
                  <span class="doc-desc">{{ p.desc }}</span>
                  <span class="doc-eg mono">{{ p.example }}</span>
                </div>
                <div class="hint">若模板中已包含 <code>{'{ext}'}</code>，则视为「完整路径模板」，不再追加文件命名模板</div>
              </div>
            </template>
          </div>
        </section>

        <section class="card">
          <h4 class="sec-title">文件命名模板</h4>
          <div class="field">
            <input v-model="s.renameTemplate" class="input mono" :placeholder="DEFAULT_NAMING_TEMPLATE" />
            <div v-for="(issue, i) in namingIssues" :key="'ni' + i" class="tpl-msg" :class="issue.level">
              <MdIcon :name="issue.level === 'error' ? 'warning' : 'info'" :size="14" />
              <span>{{ issue.message }}</span>
            </div>
            <div class="row" style="gap: 8px; margin-top: 8px; flex-wrap: wrap">
              <button v-if="namingHasError" class="btn btn-secondary btn-sm" @click="resetNaming">
                <MdIcon name="refresh" :size="14" /> 恢复默认模板
              </button>
              <span class="chip">示例结果</span>
              <span class="mono sample">{{ namingSample }}</span>
            </div>
          </div>
          <div class="doc">
            <div class="doc-title">占位符说明</div>
            <div class="doc-row doc-head">
              <span>占位符</span><span>说明</span><span>示例</span>
            </div>
            <div class="doc-row" v-for="p in namingPlaceholders" :key="p.token">
              <code>{{ p.token }}</code>
              <span class="doc-desc">{{ p.desc }}</span>
              <span class="doc-eg mono">{{ p.example }}</span>
            </div>
            <div class="hint" style="margin-top: 8px">
              默认模板语义：<strong>视频标题_作者_发布时间_分P(如果有).格式后缀</strong>
              <code>{'{p}'}</code> 在单 P 视频上整段留空（不会留下多余的 <code>_</code>）；<code>{'{index}'}</code> 则始终占位（无分P时为空）
            </div>
            <div class="hint">模板校验不通过且未修改时，下载会自动回退到默认模板，不会产生非预期的子目录</div>
          </div>
        </section>

        <section class="card">
          <h4 class="sec-title">分发与其它</h4>
          <div class="grid2">
            <div class="field">
              <span class="label">多地址分发方式</span>
              <MdSelect v-model="s.distribution" :options="distributionOptions" />
            </div>
            <div class="field" v-if="s.distribution === 'copyAfter'">
              <span class="label">分发时对主目标文件</span>
              <MdSelect v-model="s.copyVsMove" :options="copyVsMoveOptions" />
            </div>
            <div class="field">
              <span class="label">合集识别</span>
              <MdSelect v-model="s.collectionDefault" :options="collectionDefaultOptions" />
            </div>
          </div>
          <label class="row" style="gap: 8px; cursor: pointer">
            <ToggleSwitch v-model="s.fullDownload" />
            <span>默认开启全量下载（弹幕/评论/字幕/封面）</span>
          </label>
        </section>

        <section class="card">
          <h4 class="sec-title">下载稳定性 / 提速</h4>
          <div class="grid2">
            <div class="field">
              <span class="label">分片并发数（提速，1–8）</span>
              <input v-model.number="s.concurrentFragments" type="number" min="1" max="8" class="input" />
            </div>
            <div class="field">
              <span class="label">无进度超时（秒，默认 180）</span>
              <input v-model.number="s.stallTimeoutSec" type="number" min="30" max="1800" class="input" />
            </div>
            <div class="field">
              <span class="label">卡死自动重启上限（默认 2）</span>
              <input v-model.number="s.maxRestarts" type="number" min="0" max="10" class="input" />
            </div>
          </div>
          <p class="hint" style="margin-top: 8px">
            下载过程中超过「无进度超时」没有任何进展即判定卡死，自动杀掉进程并整任务重启（保留已下载分片，断点续传）；
            超过重启上限则判为失败。付费墙 / 无权限内容会直接跳过、不计入失败。重启带递增延迟，避免触发源站限流
          </p>
        </section>

        <section class="card">
          <h4 class="sec-title">下载目标地址 <span class="hint">默认上限 3 个，可增删</span></h4>
          <p class="hint" style="margin-bottom: 8px">
            <strong>主目标</strong>（列表第一项）是默认下载位置：不勾选「分发到全部目标」时，下载只落到这里
            想把某个目录设为主目标，点它后面的「设为主目标」
          </p>
          <div v-for="(d, i) in s.destinations" :key="d" class="row dest-row">
            <MdIcon :name="i === 0 ? 'star' : 'folder'" :size="15" class="dest-ic" />
            <span class="mono dest-path" :title="d">{{ d }}</span>
            <span v-if="i === 0" class="chip">主目标</span>
            <button
              v-if="i !== 0"
              class="btn btn-text btn-sm"
              title="设为下载主目标（默认下载只落到这里）"
              @click="setPrimaryDest(i)"
            >
              <MdIcon name="star" :size="13" /> 设为主目标
            </button>
            <button class="icon-btn" title="更改该目标的目录" @click="changeDest(i)">
              <MdIcon name="folderOpen" :size="15" />
            </button>
            <button class="icon-btn" title="移除" @click="removeDest(i)">
              <MdIcon name="close" :size="14" />
            </button>
          </div>
          <div class="row" style="gap: 8px; margin-top: 10px">
            <button class="btn btn-secondary btn-sm" :disabled="s.destinations.length >= 3" @click="addDest">
              <MdIcon name="add" :size="14" /> 添加目标
            </button>
            <span class="hint">{{ s.destinations.length }}/3 个（新增/主目标在保存设置后生效）</span>
          </div>
        </section>
      </template>

      <!-- Tab: 编码设置 -->
      <template v-if="activeTab === 'encoding'">
        <section class="card">
          <h4 class="sec-title">音频编码（「仅音频」下载时 FFmpeg 自动转换）</h4>
          <div class="field">
            <span class="label">默认音频格式</span>
            <div class="seg">
              <button
                v-for="c in audioCodecs"
                :key="c.value"
                class="seg-btn"
                :class="{ active: s.audioCodec === c.value }"
                @click="s.audioCodec = c.value"
              >
                {{ c.label }}
              </button>
            </div>
            <div class="hint">选择「保持源格式」则使用源站原始编码，不做转换；有损格式按最高质量档输出</div>
          </div>
        </section>

        <section class="card">
          <h4 class="sec-title">视频编码（音视频合并时的容器 + 编码）</h4>
          <div class="field">
            <span class="label">默认视频格式</span>
            <div class="seg">
              <button
                v-for="c in videoCodecs"
                :key="c.value"
                class="seg-btn"
                :class="{ active: s.videoCodec === c.value }"
                @click="s.videoCodec = c.value"
                :title="c.desc"
              >
                {{ c.label }}
              </button>
            </div>
            <div class="hint">{{ currentVideoDesc }}</div>
          </div>
          <label class="row" style="gap: 8px; cursor: pointer">
            <ToggleSwitch v-model="s.codecFallback" />
            <span>源站编码与目标不符时自动重编码（关闭则保留源编码，仅换容器）</span>
          </label>
          <p class="hint" style="margin-top: 6px">
            例：目标 MP4 而源站只提供 AV1/HEVC 时，开启后会自动转成 H.264 + AAC，避免「选了 MP4 却拿到 AV1」
          </p>
          <p class="hint">
            内置 ffmpeg 已包含 <strong>libaom-av1</strong>（AV1）与 <strong>libx265</strong>（H.265）编码器，因此选择 AV1 / H.265 时会优先挑对应编码的流，源站没有时按需重编码
          </p>
        </section>

        <section class="card">
          <h4 class="sec-title">播放器兼容</h4>
          <div class="field">
            <span class="label">遇到内置播放器无法解码的编码（HEVC / MPEG-4 / VC1 / DTS 等）</span>
            <MdSelect v-model="s.playerCompatMode" :options="playerCompatOptions" />
            <div class="hint">转码产物缓存在应用缓存目录，重复播放秒开；「清理缓存」会一并回收</div>
            <div class="hint">
            内置播放器（Chromium）原生可直接解码：视频 H.264、VP8/VP9、<strong>AV1</strong>、Theora；音频 AAC、MP3、Vorbis、Opus、FLAC、ALAC、PCM
          </div>
          <div class="hint">
            需要兜底的常见编码：H.265/HEVC、MPEG-4 Part2、VC-1、DTS、AC-3/E-AC-3、TrueHD、WMA、APE ——
            内置 ffmpeg 已具备这些<strong>解码器</strong>，会自动转成 H.264+AAC 播放
          </div>
          </div>
          <label class="row" style="gap: 8px; cursor: pointer; margin-top: 12px">
            <ToggleSwitch v-model="s.playerSystemFallback" />
            <span>调用系统播放器兜底</span>
          </label>
          <p class="hint" style="margin-top: 4px">内置解码失败时，允许用系统默认播放器（调用系统/硬件解码器）打开，覆盖 AV1 / HEVC / 更多音频编码</p>
        </section>

        <!-- 系统解码资源（自动查找环境变量 / 注册表 / 常见目录） -->
        <section class="card">
          <div class="row-between" style="flex-wrap: wrap; gap: 8px">
            <h4 class="sec-title" style="margin-bottom: 0">系统解码资源</h4>
            <div class="row" style="gap: 6px">
              <button class="btn btn-secondary btn-sm" :disabled="detecting" @click="detectResources(true)">
                <MdIcon name="search" :size="14" /> {{ detecting ? '扫描中…' : '重新扫描' }}
              </button>
            </div>
          </div>

          <label class="row" style="gap: 8px; cursor: pointer; margin-top: 10px">
            <ToggleSwitch v-model="s.autoDetectCodec" />
            <span>自动搜索系统解码资源（环境变量 PATH、注册表 App Paths / Uninstall、常见安装目录）</span>
          </label>

          <div class="grid2" style="margin-top: 10px">
            <div class="field">
              <span class="label">优先使用的系统播放器（留空 = 自动选择）</span>
              <div class="row" style="gap: 6px">
                <input v-model="s.externalPlayerPath" class="input mono" style="flex: 1" placeholder="自动" />
                <button class="btn btn-text btn-sm" @click="pickPlayer">
                  <MdIcon name="folderOpen" :size="14" /> 选择
                </button>
              </div>
            </div>
            <div class="field">
              <span class="label">外部 ffmpeg（留空 = 仅用内置；内置缺编码器时自动回退到它）</span>
              <div class="row" style="gap: 6px">
                <input v-model="s.externalFfmpegPath" class="input mono" style="flex: 1" placeholder="自动" />
                <button class="btn btn-text btn-sm" @click="pickFfmpeg">
                  <MdIcon name="folderOpen" :size="14" /> 选择
                </button>
              </div>
            </div>
          </div>

          <div v-if="detecting && !codecReport" class="hint" style="margin-top: 8px">正在扫描系统…</div>
          <div v-else-if="codecReport" class="detect-result">
            <div class="detect-row">
              <span class="detect-key">播放器</span>
              <div class="detect-val">
                <template v-if="codecReport.players.length">
                  <span v-for="p in codecReport.players" :key="p.id" class="chip ok" :title="p.path">
                    {{ p.name }} · {{ p.source }}
                  </span>
                </template>
                <span v-else class="chip warn">未检测到（可手动指定）</span>
              </div>
            </div>
            <div class="detect-row">
              <span class="detect-key">ffmpeg</span>
              <div class="detect-val">
                <span v-for="f in codecReport.ffmpegs" :key="f.id" class="chip" :title="f.path">
                  {{ f.name }} · {{ f.source }}
                </span>
                <span v-if="codecReport.ffmpegs.length === 0" class="chip warn">无</span>
              </div>
            </div>
            <div class="detect-row">
              <span class="detect-key">解码包 / 扩展</span>
              <div class="detect-val">
                <span v-for="c in codecReport.codecPacks" :key="c.id" class="chip ok">{{ c.name }}</span>
                <span v-if="codecReport.codecPacks.length === 0" class="chip warn">未检测到</span>
              </div>
            </div>
            <p class="hint" style="margin-top: 6px">
              扫描位置：{{ codecReport.scanned.join('、') }}；结果仅用于本地调用，不会上传
            </p>
          </div>
          <p class="hint" style="margin-top: 6px">
            内置播放器解码失败时，会优先调用系统播放器/解码库（如 mpv、VLC、MPC-HC、K-Lite/LAV），
            都不可用时再退回内置 ffmpeg 转码；仍不行才会提示手动处理
          </p>
        </section>
      </template>
      <!-- Tab: 播放（后台播放 / 探索） -->
      <template v-if="activeTab === 'play'">
        <section class="card">
          <h4 class="sec-title">后台播放</h4>
          <label class="row" style="gap: 8px; cursor: pointer">
            <ToggleSwitch v-model="s.backgroundPlayEnabled" />
            <span>软件未关闭时保持播放</span>
          </label>
          <p class="hint" style="margin-top: 4px">
            开启后，窗口最小化到托盘、失去焦点或切到软件其它页面时，播放不会中断；关闭则窗口不在前台即暂停，回到前台自动续播
          </p>

          <label class="row" style="gap: 8px; cursor: pointer; margin-top: 14px">
            <ToggleSwitch v-model="s.backgroundAudioOnly" :disabled="!s.backgroundPlayEnabled" />
            <span>后台时只保留声音（不加载视频，节省资源）</span>
          </label>
          <p class="hint" style="margin-top: 4px">
            探索页的在线播放是音视频分流，后台时会直接<strong>卸载视频流</strong>（省带宽与解码），仅保留音频；
            本地视频文件会暂停画面、另挂同源音频继续播放（失败时自动回退为正常播放）
            本地音频文件本身无需处理。<strong>用户可随时关闭此项</strong>
          </p>
        </section>

        <section class="card">
          <h4 class="sec-title">播放行为</h4>
          <div class="grid2">
            <div class="field">
              <span class="label">循环模式（播放列表）</span>
              <MdSelect v-model="s.loopMode" :options="loopModeOptions" />
            </div>
          </div>
          <label class="row" style="gap: 8px; cursor: pointer; margin-top: 10px">
            <ToggleSwitch v-model="s.autoPlayNext" />
            <span>播放结束后自动连播下一集</span>
          </label>
          <label class="row" style="gap: 8px; cursor: pointer; margin-top: 10px">
            <ToggleSwitch v-model="s.lyricKaraoke" />
            <span>歌词逐字染色动画（卡拉OK 式，从左到右跟唱）</span>
          </label>
          <p class="hint" style="margin-top: 4px">
            开启后，当前歌词行会随进度从左到右渐变染色，与市面主流音乐软件一致；低资源模式会自动关闭该动画
          </p>
        </section>

        <section class="card">
          <h4 class="sec-title">列表分页</h4>
          <div class="grid2">
            <div class="field">
              <span class="label">首页「任务队列」每页条数</span>
              <input v-model.number="s.queuePageSize" type="number" min="5" max="100" class="input" />
            </div>
            <div class="field">
              <span class="label">首页「下载历史」每页条数</span>
              <input v-model.number="s.downloadHistoryPageSize" type="number" min="5" max="100" class="input" />
            </div>
            <div class="field">
              <span class="label">「历史记录」每页条数</span>
              <input v-model.number="s.historyPageSize" type="number" min="5" max="100" class="input" />
            </div>
          </div>
          <p class="hint" style="margin-top: 8px">
            影响任务队列、下载历史与个人页历史记录的每页展示条数；分页条内也可临时切换（会同步保存到这里）
          </p>
        </section>

        <section class="card">
          <h4 class="sec-title">探索</h4>
          <div class="grid2">
            <div class="field">
              <span class="label">每页展示条数（默认 4×4 = 16）</span>
              <input v-model.number="s.explorePageSize" type="number" min="4" max="60" step="4" class="input" />
            </div>
          </div>
          <p class="hint" style="margin-top: 8px">
            影响「探索」分区列表与搜索结果的分页大小；搜索时该值会作为接口的 page_size 传给 B站（建议 4 的倍数，便于 4 列网格排满）
          </p>
        </section>
      </template>

      <!-- Tab: 外观 -->
      <template v-if="activeTab === 'appearance'">
        <section class="card">
          <h4 class="sec-title">外观主题</h4>
          <div class="grid2">
            <div class="field">
              <span class="label">主题模式</span>
              <MdSelect v-model="s.themeMode" :options="themeModeOptions" @update:model-value="apply" />
            </div>
            <div class="field">
              <span class="label">主色</span>
              <div class="row" style="gap: 8px">
                <input type="color" :value="s.themeColor" @input="s.themeColor = ($event.target as HTMLInputElement).value" @change="apply" class="color-input" />
                <input v-model="s.themeColor" class="input mono" style="width: 110px" @change="apply" />
                <div v-for="preset in presets" :key="preset" class="preset" :style="{ background: preset }" @click="s.themeColor = preset; apply()"></div>
              </div>
            </div>
          </div>
        </section>
      </template>

      <!-- Tab: 系统 -->
      <template v-if="activeTab === 'system'">
        <section class="card">
          <h4 class="sec-title">窗口与启动</h4>
          <label class="row" style="gap: 8px; cursor: pointer">
            <ToggleSwitch v-model="s.autoStart" />
            <span>开机自动启动</span>
          </label>
        </section>

        <section class="card">
          <h4 class="sec-title">资源与性能</h4>
          <div class="grid2">
            <div class="field">
              <span class="label">缓存上限</span>
              <MdSelect v-model="s.cacheLimitMB" :options="cacheLimitOptions" />
            </div>
            <div class="field">
              <span class="label">缓存当前占用</span>
              <div class="row" style="gap: 8px">
                <span class="mono">{{ cacheSize }} MB</span>
                <button class="btn btn-text btn-sm" @click="cleanCache">清理</button>
              </div>
            </div>
          </div>
          <div class="grid2" style="margin-top: 4px">
            <div class="field">
              <span class="label">当前内存占用</span>
              <div class="row" style="gap: 8px">
                <span class="mono">{{ memText }}</span>
                <button class="btn btn-text btn-sm" @click="refreshMemory">
                  <MdIcon name="refresh" :size="14" /> 刷新
                </button>
              </div>
            </div>
            <div class="field">
              <span class="label">内存优化</span>
              <div class="row" style="gap: 8px; flex-wrap: wrap">
                <button class="btn btn-secondary btn-sm" :disabled="optimizing" @click="doOptimizeMemory">
                  <MdIcon name="delete" :size="14" /> {{ optimizing ? '优化中…' : '立即优化内存' }}
                </button>
                <span v-if="memResult" class="hint">{{ memResult }}</span>
              </div>
            </div>
          </div>
          <p class="hint" style="margin-top: 6px">
            内存优化会调用 Windows <code>EmptyWorkingSet</code> 把本软件各进程（主进程 / 渲染进程 / GPU）
            的工作集交还系统，并清理 Chromium 代码缓存（做法参考 PCL）。任务管理器里的占用会立刻下降，
            之后按需换入，不会丢失任何数据
          </p>
          <label class="row" style="gap: 8px; cursor: pointer; margin-top: 10px">
            <ToggleSwitch v-model="s.lowResourceMode" />
            <span>低资源模式（并发收敛、减少动画）</span>
          </label>
          <label class="row" style="gap: 8px; cursor: pointer; margin-top: 10px">
            <ToggleSwitch v-model="s.hardwareAcceleration" />
            <span>硬件加速（核显可用；异常时关闭，需重启）</span>
          </label>
        </section>

        <!-- 诊断入口：系统日志（新页面，多分类 + 分页） -->
        <section class="card">
          <h4 class="sec-title">诊断</h4>
          <div class="row" style="gap: 8px; flex-wrap: wrap">
            <button class="btn btn-secondary btn-sm" @click="openSystemLog">
              <MdIcon name="list" :size="15" /> 系统日志
            </button>
            <button class="btn btn-text btn-sm" @click="openLogsDir">
              <MdIcon name="folderOpen" :size="15" /> 软件日志目录
            </button>
          </div>
          <p class="hint" style="margin-top: 6px">
            「系统日志」汇总程序日志、下载日志与 Windows 事件日志（系统 / 应用程序 / 安装 / PowerShell / 安全），
            支持分类切换与分页，方便专业用户排查错误
          </p>
        </section>

        <!-- 定时清理（资源优化） -->
        <section class="card">
          <h4 class="sec-title">定时清理</h4>
          <label class="row" style="gap: 8px; cursor: pointer">
            <ToggleSwitch v-model="s.autoCleanEnabled" />
            <span>定时自动清理（默认开启，每 6 小时检查一次）</span>
          </label>
          <div class="grid2" style="margin-top: 10px">
            <div class="field">
              <span class="label">保留天数（默认 120 天）</span>
              <input v-model.number="s.autoCleanDays" type="number" min="1" max="3650" class="input" />
            </div>
            <div class="field">
              <span class="label">立即清理</span>
              <div class="row" style="gap: 8px">
                <button class="btn btn-secondary btn-sm" :disabled="cleaning" @click="cleanNow">
                  <MdIcon name="delete" :size="14" /> {{ cleaning ? '清理中…' : '立即清理一次' }}
                </button>
                <span v-if="lastCleanText" class="hint">{{ lastCleanText }}</span>
              </div>
            </div>
          </div>
          <div class="row" style="gap: 16px; flex-wrap: wrap; margin-top: 8px">
            <label class="row" style="gap: 6px; cursor: pointer">
              <ToggleSwitch v-model="s.cleanPlayHistory" />
              <span>清理播放历史 / 进度</span>
            </label>
            <label class="row" style="gap: 6px; cursor: pointer">
              <ToggleSwitch v-model="s.cleanDownloadLogs" />
              <span>清理下载日志</span>
            </label>
            <label class="row" style="gap: 6px; cursor: pointer">
              <ToggleSwitch v-model="s.cleanAppLogs" />
              <span>清理程序日志</span>
            </label>
          </div>
          <p class="hint" style="margin-top: 8px">
            每次清理会删除超出保留期的播放历史、日志条目，以及缓存目录中过期的转码产物与封面缩略图；随后再按「缓存上限」兜底回收
          </p>
        </section>

        <section class="card">
          <h4 class="sec-title">配置文件</h4>
          <div class="row" style="gap: 8px; flex-wrap: wrap">
            <button class="btn btn-text btn-sm" @click="openSettingsFile">
              <MdIcon name="folderOpen" :size="15" /> 打开 settings.json 所在位置
            </button>
            <button class="btn btn-text btn-sm" @click="exportSettings">
              <MdIcon name="download" :size="15" /> 导出设置
            </button>
            <button class="btn btn-text btn-sm" @click="showImport = true">
              <MdIcon name="add" :size="15" /> 导入设置
            </button>
          </div>
          <p class="hint" style="margin-top: 6px">
            设置以 JSON 文件持久化在用户数据目录，可自行备份或迁移；点「保存设置」后写入
          </p>
        </section>

        <section class="card">
          <h4 class="sec-title">网络</h4>
          <div class="grid2">
            <div class="field">
              <span class="label">代理（HTTP/SOCKS5，留空 = 直连）</span>
              <input v-model="s.proxy" class="input" placeholder="http://127.0.0.1:7890 或 socks5://…" />
            </div>
            <div class="field">
              <span class="label">User-Agent（留空用默认）</span>
              <input v-model="s.userAgent" class="input" />
            </div>
          </div>
          <label class="row" style="gap: 8px; cursor: pointer; margin-top: 6px">
            <ToggleSwitch v-model="s.useSystemProxy" />
            <span>使用操作系统代理（默认关闭）</span>
          </label>
          <p class="hint" style="margin-top: 4px">
            默认<strong>直连</strong>：yt-dlp 会忽略系统代理。若你开着 Steam++ / Watt Toolkit、游戏加速器、
            这类工具，它们会把系统代理设成 <code>127.0.0.1:xxxx</code>，其证书不在 yt-dlp 的信任库中，
            会导致 <code>[SSL: CERTIFICATE_VERIFY_FAILED]</code>「所有视频都下载失败」
            只有当你确实需要通过系统代理（如全局 VPN）联网时，才打开此项
          </p>
          <label class="row" style="gap: 8px; cursor: pointer">
            <ToggleSwitch v-model="s.friendlyThrottle" />
            <span>友好节流（降低源站风控风险）</span>
          </label>
        </section>
      </template>

      <!-- Tab: 插件 -->
      <template v-if="activeTab === 'plugins'">
        <section class="card">
          <div class="row-between" style="flex-wrap: wrap; gap: 8px">
            <div>
              <h4 class="sec-title" style="margin-bottom: 2px">插件</h4>
              <p class="hint">插件以目录形式安装（含 manifest.json + 入口 JS），在沙箱中运行，仅能使用受控 API</p>
            </div>
            <div class="row" style="gap: 6px">
              <button class="btn btn-secondary btn-sm" @click="installPlugin">
                <MdIcon name="add" :size="14" /> 安装插件
              </button>
              <button class="btn btn-text btn-sm" @click="openPluginDir">
                <MdIcon name="folderOpen" :size="15" /> 插件目录
              </button>
              <button class="btn btn-text btn-sm" @click="reloadPlugins">
                <MdIcon name="refresh" :size="14" /> 重新加载
              </button>
            </div>
          </div>

          <div v-if="plugins.length === 0" class="empty" style="padding: 28px">
            <MdIcon name="extension" :size="34" class="empty-icon" />
            <div>尚未安装第三方插件</div>
          </div>
          <div v-else class="plugin-list">
            <div v-for="p in plugins" :key="p.manifest.id" class="plugin-row">
              <MdIcon name="extension" :size="20" class="plugin-icon" />
              <div class="plugin-info">
                <div class="plugin-title">
                  {{ p.manifest.name }}
                  <span class="chip">v{{ p.manifest.version }}</span>
                  <span v-if="p.builtin" class="chip ok">内置</span>
                  <span v-else class="chip">第三方</span>
                  <span v-if="p.error" class="chip err">加载失败</span>
                </div>
                <div class="plugin-sub mono">{{ p.manifest.id }}</div>
                <div v-if="p.manifest.description" class="plugin-sub">{{ p.manifest.description }}</div>
                <div v-if="p.manifest.author" class="plugin-sub">作者：{{ p.manifest.author }}</div>
                <div v-if="p.error" class="plugin-err">{{ p.error }}</div>
              </div>
              <div class="row" style="gap: 4px; flex-shrink: 0">
                <label class="row" style="gap: 6px; cursor: pointer" :title="p.builtin ? '内置插件不可禁用' : ''">
                  <ToggleSwitch
                    :model-value="p.enabled"
                    :disabled="p.builtin"
                    @update:model-value="(v) => togglePlugin(p.manifest.id, v)"
                  />
                </label>
                <button class="icon-btn" title="卸载" :disabled="p.builtin" @click="uninstallPlugin(p.manifest.id)">
                  <MdIcon name="delete" :size="15" />
                </button>
              </div>
            </div>
          </div>
        </section>

        <section class="card">
          <h4 class="sec-title">插件开发（manifest.json 示例）</h4>
          <pre class="code mono">{{ pluginExample }}</pre>
          <p class="hint">
            插件入口运行在 <code>node:vm</code> 沙箱中，可用对象：<code>vd</code>（受控 API）、<code>fetch</code>、<code>console</code>；
            <strong>不提供 <code>require</code></strong>契约：<code>module.exports = { match(url), resolve(url, api) }</code>
          </p>
        </section>
      </template>

      <!-- Tab: 关于 -->
      <template v-if="activeTab === 'about'">
        <section class="card">
          <h4 class="sec-title">
            <MdIcon name="info" :size="16" /> 软件信息
          </h4>
          <div class="about-grid">
            <div class="about-row">
              <span class="about-key">软件名称</span>
              <span class="about-val">VD 视频下载器</span>
            </div>
            <div class="about-row">
              <span class="about-key">软件版本</span>
              <span class="about-val mono">{{ sys.version || '—' }}</span>
            </div>
            <div class="about-row">
              <span class="about-key">补丁版本</span>
              <span class="about-val mono">{{ sys.patchVersion || '—' }}</span>
            </div>
            <div class="about-row">
              <span class="about-key">构建日期</span>
              <span class="about-val mono">{{ sys.buildDate || '—' }}</span>
            </div>
            <div class="about-row">
              <span class="about-key">系统平台</span>
              <span class="about-val">{{ sys.osName || '—' }}</span>
            </div>
            <div class="about-row">
              <span class="about-key">系统版本</span>
              <span class="about-val mono">{{ sys.osVersion || '—' }}</span>
            </div>
            <div class="about-row">
              <span class="about-key">架构</span>
              <span class="about-val mono">{{ sys.arch || '—' }}</span>
            </div>
            <div class="about-row">
              <span class="about-key">运行环境</span>
              <span class="about-val mono">
                Electron {{ sys.electronVersion }} · Node {{ sys.nodeVersion }} · Chrome {{ sys.chromeVersion }}
              </span>
            </div>
            <div class="about-row">
              <span class="about-key">磁盘剩余</span>
              <span class="about-val mono">{{ sys.diskFreeMB ?? 0 }} MB</span>
            </div>
          </div>
        </section>

        <section class="card">
          <h4 class="sec-title">
            <MdIcon name="person" :size="16" /> 开发者信息
          </h4>
          <div class="about-grid">
            <div class="about-row">
              <span class="about-key">开发者</span>
              <span class="about-val"><strong>207研究所</strong></span>
            </div>
            <div class="about-row">
              <span class="about-key">官网</span>
              <span class="about-val">
                <a class="link" href="#" @click.prevent="openSite">apart207.top</a>
              </span>
            </div>
            <div class="about-row">
              <span class="about-key">开源信息</span>
              <span class="about-val">Gitee 平台开源核心代码</span>
            </div>
            <div class="about-row">
              <span class="about-key">开源地址</span>
              <span class="about-val">
                <a class="link mono" href="#" @click.prevent="openRepo">https://gitee.com/buelierm/VideoDownloadTool</a>
              </span>
            </div>
            <div class="about-row">
              <span class="about-key">开源协议</span>
              <span class="about-val">
                <MdSelect v-model="licenseChoice" :options="licenseOptions" />
              </span>
            </div>
          </div>
          <p class="hint" style="margin-top: 10px">{{ licenseAdvice }}</p>
        </section>

        <section class="card">
          <h4 class="sec-title">
            <MdIcon name="extension" :size="16" /> 第三方库 / 软件 / SDK
          </h4>
          <table class="dep-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>用途</th>
                <th>许可证</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="d in dependencies" :key="d.name">
                <td>{{ d.name }}</td>
                <td class="dep-use">{{ d.use }}</td>
                <td><code>{{ d.license }}</code></td>
              </tr>
            </tbody>
          </table>
          <p class="hint" style="margin-top: 10px">
            yt-dlp 与 ffmpeg 以可执行文件形式内置于 <code>resources/bin/</code>；分发时一并保留随包的第三方许可说明
          </p>
        </section>

        <section class="card">
          <h4 class="sec-title">通知与数据</h4>
          <label class="row" style="gap: 8px; cursor: pointer">
            <ToggleSwitch v-model="s.notifyOnComplete" />
            <span>下载完成系统通知</span>
          </label>
          <label class="row" style="gap: 8px; cursor: pointer; margin-top: 10px">
            <ToggleSwitch v-model="s.privacyMode" />
            <span>隐私模式（不记录历史、无日志）</span>
          </label>
          <div class="row" style="gap: 8px; margin-top: 12px">
            <button class="btn btn-secondary btn-sm" @click="exportSettings">导出设置</button>
            <button class="btn btn-secondary btn-sm" @click="importSettings">导入设置</button>
          </div>
        </section>

        <section class="card">
          <p class="about">
            仅供个人学习、备份已获授权或公开内容使用；不含突破付费墙 / DRM / 会员权限
          </p>
        </section>
      </template>
    </div>

    <!-- 设置导入弹窗 -->
    <InputDialog
      :open="showImport"
      title="导入设置"
      desc="粘贴导出的设置 JSON（不含登录凭据）"
      label="设置 JSON"
      confirm-text="导入"
      @confirm="doImport"
      @cancel="showImport = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import type { AppInfo, PluginInfo, Settings } from '@shared/types'
import {
  DEFAULT_NAMING_TEMPLATE,
  FOLDER_PLACEHOLDERS,
  NAMING_PLACEHOLDERS,
  effectiveFolderTemplate,
  effectiveNamingTemplate,
  hasBlockingIssue,
  validateFolderTemplate,
  validateNamingTemplate
} from '@shared/template'
import { store, toast, updateSettings } from '../store/app'
import { applyTheme } from '../theme/theme'
import ToggleSwitch from '../components/ToggleSwitch.vue'
import MdIcon from '../components/MdIcon.vue'
import MdSelect from '../components/MdSelect.vue'
import MdTabs from '../components/MdTabs.vue'
import InputDialog from '../components/InputDialog.vue'

const tabs = [
  { id: 'download', label: '下载', icon: 'download' },
  { id: 'encoding', label: '编码设置', icon: 'refresh' },
  { id: 'play', label: '播放', icon: 'play' },
  { id: 'appearance', label: '外观', icon: 'palette' },
  { id: 'system', label: '系统', icon: 'settings' },
  { id: 'plugins', label: '插件', icon: 'extension' },
  { id: 'about', label: '关于', icon: 'info' }
] as const

type TabId = (typeof tabs)[number]['id']
const activeTab = ref<TabId>('download')
const navTabs = tabs.map((t) => ({ label: t.label, value: t.id, icon: t.icon }))

const folderModes = [
  { value: 'flat', label: '同目录', desc: '所有文件放入目标目录' },
  { value: 'uploader', label: '作者隔离', desc: '按 UP 主文件夹隔离' },
  { value: 'custom', label: '自定义', desc: '用户自定义模板' }
] as const

const audioCodecs = [
  { value: 'none', label: '保持源格式' },
  { value: 'mp3', label: 'MP3' },
  { value: 'flac', label: 'FLAC' },
  { value: 'wav', label: 'WAV' },
  { value: 'aac', label: 'AAC' },
  { value: 'm4a', label: 'M4A' },
  { value: 'opus', label: 'Opus' }
] as const

const videoCodecs = [
  { value: 'none', label: '保持源格式', desc: '不做任何容器/编码限制' },
  { value: 'mp4', label: 'MP4', desc: 'H.264 视频 + AAC 音频，兼容性最好（推荐）' },
  { value: 'mkv', label: 'MKV', desc: '保持源编码，仅封装为 MKV（不重编码）' },
  { value: 'webm', label: 'WebM', desc: 'VP9 视频 + Opus 音频' },
  { value: 'mov', label: 'MOV', desc: 'H.264 + AAC，MOV 容器' },
  { value: 'av1', label: 'AV1', desc: 'AV1 视频 + AAC：体积更小，内置播放器可直接解码（编码较慢）' },
  { value: 'hevc', label: 'H.265', desc: 'HEVC 视频 + AAC（MKV 容器）：体积小，但 Chromium 不能直接解码，建议配合系统播放器' }
] as const

const currentVideoDesc = computed(() => videoCodecs.find((c) => c.value === s.videoCodec)?.desc ?? '')

const presets = ['#64B5F6', '#7E57C2', '#4DB6AC', '#FF8A65', '#81C784', '#F06292']

// ---------- MD3 下拉选项 ----------
const contentOptions = [
  { label: '仅音频', value: 'audio' },
  { label: '仅视频', value: 'video' },
  { label: '音视频', value: 'both' }
]
const qualityOptions = [
  { label: '360P', value: 360 },
  { label: '480P', value: 480 },
  { label: '720P', value: 720 },
  { label: '1080P', value: 1080 }
]
const distributionOptions = [
  { label: '方式一：先下载再复制', value: 'copyAfter' },
  { label: '方式二：各地址独立下载', value: 'parallel' }
]
const copyVsMoveOptions = [
  { label: '复制到其他地址', value: 'copy' },
  { label: '移动到其他地址', value: 'move' }
]
const collectionDefaultOptions = [
  { label: '每次询问', value: 'ask' },
  { label: '自动下载合集全部', value: 'yes' },
  { label: '只下载收藏夹内容', value: 'no' }
]
const cacheLimitOptions = [
  { label: '512 MB', value: 512 },
  { label: '1 GB', value: 1024 },
  { label: '2 GB', value: 2048 },
  { label: '4 GB', value: 4096 }
]
const playerCompatOptions = [
  { label: '自动转码为 H.264 + AAC 后播放', value: 'auto' },
  { label: '手动确认后再转码', value: 'manual' }
]
const loopModeOptions = [
  { label: '列表循环', value: 'list' },
  { label: '单集循环', value: 'single' },
  { label: '随机播放', value: 'shuffle' }
]
const themeModeOptions = [
  { label: '亮色', value: 'light' },
  { label: '暗色', value: 'dark' },
  { label: '跟随系统', value: 'system' }
]
// 三个协议均可采用（下拉选择），标签中不再标注「推荐」，理由在下方说明区展示
const licenseOptions = [
  { label: 'GPL-3.0-or-later', value: 'GPL-3.0-or-later' },
  { label: 'MIT', value: 'MIT' },
  { label: 'AGPL-3.0-or-later', value: 'AGPL-3.0-or-later' }
]

// ---------- 草稿式设置（显式「保存」按钮，避免误改立即生效） ----------
const s = reactive<Settings>({ ...(store.settings ?? ({} as Settings)) })
const cacheSize = ref(store.sysInfo?.cacheSizeMB ?? 0)
const sys = computed(() => (store.sysInfo ?? {}) as Partial<AppInfo>)

/** 保存基线：用于判断是否存在未保存更改（必须是 ref，否则 computed 不会因基线变化而重算） */
const baseline = ref(JSON.stringify(s))
const dirty = computed(() => JSON.stringify(s) !== baseline.value)

/** 把当前草稿同步到基线（保存/撤销/导入后调用） */
function markClean(): void {
  baseline.value = JSON.stringify(s)
}

// 首屏设置异步到达 / 外部（导入、其它页面）修改时同步草稿
watch(
  () => store.settings,
  (v) => {
    if (!v) return
    if (!dirty.value) {
      Object.assign(s, v)
      markClean()
    }
  },
  { immediate: true }
)

/** 保存全部设置（含模板合法性兜底） */
async function saveAll(): Promise<void> {
  // ① 命名模板与目录模式冲突（如同目录下含 /）→ 自动回退默认模板
  const naming = (s.renameTemplate ?? '').trim()
  const effNaming = effectiveNamingTemplate(s.folderMode, naming)
  if (effNaming !== naming) {
    s.renameTemplate = effNaming
    toast('命名模板与当前目录模式冲突，已自动改用默认模板', 'error')
  }
  // ② 自定义目录模板非法 → 回退（直接放目标目录）
  if (s.folderMode === 'custom') {
    const effDir = effectiveFolderTemplate('custom', s.customFolderTemplate ?? '')
    const rawDir = (s.customFolderTemplate ?? '').trim().replace(/^[\\/]+|[\\/]+$/g, '')
    if (effDir !== rawDir) s.customFolderTemplate = effDir
  }
  try {
    // 注意：s 是 reactive(Proxy)，按字段逐个取原始值，避免 Proxy 无法通过 IPC 结构化克隆
    await updateSettings(JSON.parse(JSON.stringify(s)) as Partial<Settings>)
    markClean()
    toast('设置已保存到 settings.json', 'success')
  } catch (e) {
    toast(`保存失败：${e instanceof Error ? e.message : String(e)}`, 'error')
  }
}

/** 撤销未保存的更改 */
function resetDraft(): void {
  if (store.settings) Object.assign(s, store.settings)
  markClean()
  applyTheme(s)
  toast('已撤销未保存的更改')
}

// ---------- 模板校验 / 文档 ----------

const namingPlaceholders = NAMING_PLACEHOLDERS
const folderPlaceholders = FOLDER_PLACEHOLDERS

const namingIssues = computed(() => validateNamingTemplate(s.folderMode, s.renameTemplate))
const folderIssues = computed(() => validateFolderTemplate(s.folderMode, s.customFolderTemplate))
const namingHasError = computed(() => hasBlockingIssue(namingIssues.value))

/** 用假数据渲染一份示例文件名，便于理解模板 */
const namingSample = computed(() => {
  const tpl = effectiveNamingTemplate(s.folderMode, s.renameTemplate)
  const dir = effectiveFolderTemplate(s.folderMode, s.customFolderTemplate)
  const file = tpl
    .replace(/\{title\}/g, '【4K】风景合集')
    .replace(/\{uploader\}/g, '碧诗')
    .replace(/\{date\}/g, '20240115')
    .replace(/\{p\}/g, '_3')
    .replace(/\{index\}/g, '3')
    .replace(/\{quality\}/g, '1080')
    .replace(/\{favName\}/g, '我的收藏')
    .replace(/\{ext\}/g, 'mp4')
  return dir ? `${dir} / ${file}` : file
})

function resetNaming(): void {
  s.renameTemplate = DEFAULT_NAMING_TEMPLATE
  toast('已恢复默认命名模板')
}

// ---------- 插件 ----------

const plugins = ref<PluginInfo[]>([])
const pluginExample = `{
  "id": "example.site",
  "name": "示例站点适配",
  "version": "1.0.0",
  "description": "让 VD 支持 example.com",
  "author": "your-name",
  "homepage": "https://example.com",
  "matchPatterns": ["https://example.com/watch*"],
  "capabilities": ["audio", "video"],
  "entry": "index.js",
  "minAppVersion": "0.1.0"
}

// index.js（在 node:vm 沙箱中执行，无 require）
module.exports = {
  match(url) { return url.includes('example.com') },
  async resolve(url, api) {
    const data = await api.fetchJson(url)
    return { title: data.title, uploader: data.author, url: data.stream }
  }
}`

async function loadPlugins(): Promise<void> {
  plugins.value = await window.vd.listPlugins()
}

async function installPlugin(): Promise<void> {
  const dir = await window.vd.openDirectory()
  if (!dir) return
  const res = await window.vd.installPlugin(dir)
  if (res.ok) {
    toast(`已安装插件「${res.manifest?.name ?? dir}」`, 'success')
    await loadPlugins()
  } else {
    toast(`安装失败: ${res.error}`, 'error')
  }
}

async function uninstallPlugin(id: string): Promise<void> {
  const res = await window.vd.uninstallPlugin(id)
  if (res.ok) {
    toast('已卸载插件')
    await loadPlugins()
  } else {
    toast(res.error ?? '卸载失败', 'error')
  }
}

async function togglePlugin(id: string, enabled: boolean): Promise<void> {
  await window.vd.setPluginEnabled(id, enabled)
  await loadPlugins()
}

async function reloadPlugins(): Promise<void> {
  plugins.value = await window.vd.reloadPlugins()
  toast('插件已重新加载')
}

async function openPluginDir(): Promise<void> {
  const dir = await window.vd.openPluginsDir()
  toast(`插件目录：${dir}`)
}

// ---------- 关于 ----------

const licenseChoice = ref('GPL-3.0-or-later')
const licenseAdvice = computed(() => {
  switch (licenseChoice.value) {
    case 'MIT':
      return 'MIT：内置 ffmpeg（GPL-2.0+）与 libx264（GPL）属 GPL 组件，随包分发时单独附第三方许可清单并提供 GPL 组件源码或书面索取方式'
    case 'AGPL-3.0-or-later':
      return 'AGPL-3.0-or-later：未来提供 Web 服务形态（用户通过网络使用该软件）备用；桌面分发场景下与 GPL-3.0 差别不大'
    default:
      return 'GPL-3.0-or-later：内置 ffmpeg 与 libx264 均为 GPL 组件，软件随包分发时整体需按 GPL 合规。采用 GPL-3.0 与依赖保持一致，避免开源核心代码时出现「宽松许可证项目分发 GPL 二进制」的合规争议'
  }
})

const dependencies = [
  { name: 'yt-dlp', use: '站点解析与下载引擎（内置可执行文件）', license: 'Unlicense' },
  { name: 'ffmpeg', use: '音视频合并 / 转码 / 编码探测（内置可执行文件）', license: 'GPL-2.0-or-later（含 libx264 的 GPL 构建）' },
  { name: 'Electron', use: '桌面应用运行时（Chromium + Node.js）', license: 'MIT' },
  { name: 'Chromium', use: '内置播放器解码与界面渲染（随 Electron 分发）', license: 'BSD-3-Clause 等（随 Electron 许可）' },
  { name: 'Node.js', use: '主进程运行时（随 Electron 分发）', license: 'MIT' },
  { name: 'Vue 3', use: '渲染端界面框架', license: 'MIT' },
  { name: 'TypeScript', use: '类型系统', license: 'Apache-2.0' },
  { name: 'Vite', use: '渲染端构建工具', license: 'MIT' },
  { name: 'electron-builder', use: '打包与安装程序生成', license: 'MIT' }
]

function openSite(): void {
  void window.vd.openExternal('https://apart207.top')
}

/** 打开开源仓库（Gitee） */
function openRepo(): void {
  void window.vd.openExternal('https://gitee.com/buelierm/VideoDownloadTool')
}

// ---------- 通用 ----------

/** 主题实时预览（实际落盘由「保存」按钮完成，便于撤销） */
function apply(): void {
  applyTheme({ themeMode: s.themeMode, themeColor: s.themeColor, lowResourceMode: s.lowResourceMode })
}

async function addDest(): Promise<void> {
  const dir = await window.vd.pickDownloadDir()
  if (!dir) return
  if (s.destinations.includes(dir)) {
    toast('该目录已在列表中')
    return
  }
  s.destinations.push(dir)
}

function removeDest(i: number): void {
  if (s.destinations.length <= 1) {
    toast('至少保留一个下载目标')
    return
  }
  s.destinations.splice(i, 1)
}

/** 把某个目标提为「主目标」（列表第一项） */
function setPrimaryDest(i: number): void {
  if (i <= 0 || i >= s.destinations.length) return
  const [dir] = s.destinations.splice(i, 1)
  s.destinations.unshift(dir)
  toast(`已把「${shortName(dir)}」设为主目标，保存后生效`)
}

/** 就地更换某个目标的目录（不改变它在列表中的位置/主目标身份） */
async function changeDest(i: number): Promise<void> {
  const dir = await window.vd.pickDownloadDir()
  if (!dir) return
  if (s.destinations.some((d, k) => k !== i && d === dir)) {
    toast('该目录已在列表中')
    return
  }
  s.destinations.splice(i, 1, dir)
  toast('已更换目标目录，保存后生效')
}

/** 取路径末段用于提示 */
function shortName(p: string): string {
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || p
}

async function cleanCache(): Promise<void> {
  const remaining = await window.vd.cleanCache()
  cacheSize.value = remaining
  toast('缓存已清理')
}

// ---------- 系统解码资源探测 ----------
const codecReport = ref<{
  players: Array<{ id: string; name: string; path: string; source: string }>
  ffmpegs: Array<{ id: string; name: string; path: string; source: string }>
  codecPacks: Array<{ id: string; name: string }>
  scanned: string[]
} | null>(null)
const detecting = ref(false)

async function detectResources(force = false): Promise<void> {
  detecting.value = true
  try {
    // peek = !force：非强制时只读主进程缓存，不触发扫描（避免进页面就扫注册表导致卡顿）
    codecReport.value = await window.vd.detectCodecResources(force, !force)
  } catch (e) {
    toast(`扫描失败：${e instanceof Error ? e.message : String(e)}`, 'error')
  } finally {
    detecting.value = false
  }
}

async function pickPlayer(): Promise<void> {
  const p = await window.vd.pickExternalPlayer()
  if (p) {
    s.externalPlayerPath = p
    toast('已指定系统播放器，保存后生效')
  }
}

async function pickFfmpeg(): Promise<void> {
  const files = await window.vd.openFile({
    filters:
      process.platform === 'win32'
        ? [{ name: '可执行文件', extensions: ['exe'] }]
        : [{ name: '所有文件', extensions: ['*'] }]
  })
  if (files[0]) {
    s.externalFfmpegPath = files[0]
    toast('已指定外部 ffmpeg，保存后生效')
  }
}

// ---------- 内存优化 / 系统日志 ----------

const memTotal = ref(0)
const memProcesses = ref(0)
const memResult = ref('')
const optimizing = ref(false)
const memText = computed(() =>
  memTotal.value ? `${memTotal.value} MB（${memProcesses.value} 个进程）` : '—'
)

async function refreshMemory(): Promise<void> {
  try {
    const r = await window.vd.getMemory()
    memTotal.value = r.totalMB
    memProcesses.value = r.processes
  } catch {
    /* 读取失败不影响其它功能 */
  }
}

/** 内存优化：回收工作集 + 清理代码缓存（PCL 式做法） */
async function doOptimizeMemory(): Promise<void> {
  optimizing.value = true
  memResult.value = ''
  try {
    const r = await window.vd.optimizeMemory()
    memTotal.value = r.afterMB
    memResult.value = `回收 ${r.freedMB} MB（${r.beforeMB} → ${r.afterMB} MB，${r.processes} 个进程）`
    toast(
      r.ok ? `内存优化完成：回收 ${r.freedMB} MB` : `内存优化未生效：${r.error ?? r.note ?? '未知原因'}`,
      r.ok ? 'success' : 'error'
    )
  } catch (e) {
    toast(`内存优化失败：${e instanceof Error ? e.message : String(e)}`, 'error')
  } finally {
    optimizing.value = false
  }
}

/** 跳到「系统日志」页 */
function openSystemLog(): void {
  store.view = 'systemLog'
}

async function openLogsDir(): Promise<void> {
  const dir = await window.vd.openLogsDir()
  toast(`软件日志目录：${dir}`)
}

// ---------- 定时清理 ----------
const cleaning = ref(false)
const lastCleanText = ref('')

/** 立即执行一次资源清理（忽略周期限制），会读取当前草稿里的保留天数与范围 */
async function cleanNow(): Promise<void> {
  cleaning.value = true
  lastCleanText.value = ''
  try {
    // 先把清理相关设置写入（否则主进程读到的是旧值）
    await updateSettings({
      autoCleanEnabled: s.autoCleanEnabled,
      autoCleanDays: s.autoCleanDays,
      cleanPlayHistory: s.cleanPlayHistory,
      cleanDownloadLogs: s.cleanDownloadLogs,
      cleanAppLogs: s.cleanAppLogs,
      cacheLimitMB: s.cacheLimitMB
    })
    markClean()
    const res = await window.vd.cleanNow()
    cacheSize.value = res.cacheSizeMB
    const r = res.report ?? {}
    lastCleanText.value = `历史 ${r.removedHistory ?? 0} 条 · 日志 ${r.removedLogs ?? 0} 行 · 缓存 ${r.freedCacheMB ?? 0} MB`
    toast(`清理完成：${lastCleanText.value}`, 'success')
  } catch (e) {
    toast(`清理失败：${e instanceof Error ? e.message : String(e)}`, 'error')
  } finally {
    cleaning.value = false
  }
}

async function exportSettings(): Promise<void> {
  const raw = await window.vd.exportSettings()
  await navigator.clipboard.writeText(raw).catch(() => undefined)
  toast('设置已复制到剪贴板（JSON，不含登录凭据）')
}

const showImport = ref(false)

function importSettings(): void {
  showImport.value = true
}

async function doImport(text: string): Promise<void> {
  showImport.value = false
  const res = await window.vd.importSettings(text)
  if (res.ok) {
    toast('设置已导入', 'success')
    if (store.settings) {
      Object.assign(s, store.settings)
      markClean()
      applyTheme(store.settings)
    }
  } else {
    toast(`导入失败: ${res.error}`, 'error')
  }
}

/** 打开 settings.json 所在目录（用户可自行查看/备份持久化文件） */
async function openSettingsFile(): Promise<void> {
  const p = await window.vd.openSettingsFile()
  toast(p ? `设置文件：${p}` : '未能定位设置文件')
}

onMounted(() => {
  void loadPlugins()
  // 首屏展示一次系统解码资源（主进程有缓存，不会重复扫描）
  void detectResources(false)
  // 展示当前内存占用（轻量，不触发扫描）
  void refreshMemory()
})
</script>

<style scoped>
.settings-layout {
  display: flex;
  gap: 0;
  height: 100%;
  min-height: 0;
  background: transparent;
}

/* 左栏上下填满，内容区独立滚动 */
.settings-nav {
  width: 180px;
  flex-shrink: 0;
  align-self: stretch;
  padding: 20px 12px;
  border-right: 1px solid var(--md-outline-variant);
  background: var(--md-surface-container);
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}

.nav-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 8px 14px;
}

.nav-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--md-on-surface);
}

.save-btn {
  flex-shrink: 0;
}

.nav-foot {
  margin-top: auto;
  padding-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.save-state {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--md-on-surface-variant);
  padding: 0 4px;
}

.save-state.dirty {
  color: var(--md-warning);
}

/* MD3 下拉在字段内撑满整行 */
.field :deep(.md-select) {
  display: block;
  width: 100%;
}

/* 左栏纵向选项卡：不参与压缩，避免滚动时被压扁 */
.nav-tabs {
  flex-shrink: 0;
}

/* 系统解码资源探测结果 */
.detect-result {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.detect-row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  font-size: 12px;
}

.detect-key {
  flex-shrink: 0;
  width: 92px;
  color: var(--md-on-surface-variant);
  padding-top: 2px;
}

.detect-val {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}

.nav-icon {
  width: 22px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.settings-content {
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow-y: auto;
  padding: 20px 24px 40px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 说明：.sec-title / .hint / .seg / .seg-btn / .mono / .field / .label / .nav-item 等统一在 styles/ 目录 */
.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 20px;
}

@media (max-width: 760px) {
  .grid2 {
    grid-template-columns: 1fr;
  }
  .settings-layout {
    flex-direction: column;
  }
  /* 窄屏：保持纵向选项卡（与指示器方向一致），限制高度后独立滚动 */
  .settings-nav {
    width: 100%;
    align-self: auto;
    max-height: 42vh;
    padding: 12px;
    border-right: none;
    border-bottom: 1px solid var(--md-outline-variant);
  }
  .nav-tabs {
    flex-direction: column;
  }
  .nav-title {
    display: none;
  }
  .nav-head {
    padding: 0;
  }
  .nav-foot {
    margin-top: 0;
    flex-direction: row;
    align-items: center;
  }
}

.dest-row {
  padding: 6px 8px;
  border-radius: var(--md-radius-sm);
  background: var(--md-surface-container-low);
  margin-bottom: 6px;
}

.dest-ic {
  flex-shrink: 0;
  color: var(--md-on-surface-variant);
}

.dest-path {
  flex: 1;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: text;
}

.color-input {
  width: 36px;
  height: 30px;
  border: 1px solid var(--md-outline-variant);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
}

.preset {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  cursor: pointer;
  border: 2px solid transparent;
  transition: border-color 0.15s;
}

.preset:hover {
  border-color: var(--md-on-surface-variant);
}

/* ---- 模板文档 / 校验 ---- */
.tpl-msg {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.6;
  padding: 6px 10px;
  border-radius: var(--md-radius-sm);
}

.tpl-msg > :deep(.md-icon) {
  margin-top: 2px;
  flex-shrink: 0;
}

.tpl-msg.error {
  color: var(--md-error);
  background: color-mix(in srgb, var(--md-error) 12%, transparent);
}

.tpl-msg.warn {
  color: var(--md-warning);
  background: color-mix(in srgb, var(--md-warning) 12%, transparent);
}

.sample {
  font-size: 12px;
  color: var(--md-on-surface-variant);
  word-break: break-all;
}

.doc {
  margin-top: 12px;
  border: 1px solid var(--md-outline-variant);
  border-radius: var(--md-radius-sm);
  padding: 10px 12px;
  background: var(--md-surface-container-low);
}

.doc-title {
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 8px;
}

.doc-row {
  display: grid;
  grid-template-columns: 96px 1fr 88px;
  gap: 8px;
  align-items: baseline;
  padding: 4px 0;
  font-size: 12px;
}

.doc-head {
  font-weight: 600;
  color: var(--md-on-surface-variant);
  border-bottom: 1px solid var(--md-outline-variant);
  padding-bottom: 6px;
  margin-bottom: 4px;
}

.doc-desc {
  color: var(--md-on-surface-variant);
}

.doc-eg {
  color: var(--md-on-surface-variant);
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

code {
  font-family: var(--md-font-mono);
  font-size: 11px;
  background: var(--md-surface-container-highest);
  padding: 1px 4px;
  border-radius: 4px;
}

/* ---- 插件 ---- */
.plugin-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}

.plugin-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--md-radius-sm);
  background: var(--md-surface-container-low);
}

.plugin-icon {
  margin-top: 2px;
  opacity: 0.7;
}

.plugin-info {
  flex: 1;
  min-width: 0;
}

.plugin-title {
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.plugin-sub {
  font-size: 11px;
  color: var(--md-on-surface-variant);
  margin-top: 2px;
  word-break: break-all;
}

.plugin-err {
  font-size: 11px;
  color: var(--md-error);
  margin-top: 4px;
}

.code {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  background: var(--md-surface-container-highest);
  padding: 12px;
  border-radius: var(--md-radius-sm);
  overflow-x: auto;
  white-space: pre;
}

/* ---- 关于 ---- */
.about-grid {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.about-row {
  display: grid;
  grid-template-columns: 92px 1fr;
  gap: 10px;
  padding: 7px 4px;
  font-size: 13px;
  border-bottom: 1px solid var(--md-outline-variant);
}

.about-row:last-child {
  border-bottom: none;
}

.about-key {
  color: var(--md-on-surface-variant);
  font-size: 12px;
}

.about-val {
  min-width: 0;
  word-break: break-all;
}

.link {
  color: var(--md-primary);
  text-decoration: none;
  cursor: pointer;
}

.link:hover {
  text-decoration: underline;
}

.dep-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.dep-table th,
.dep-table td {
  border: 1px solid var(--md-outline-variant);
  padding: 7px 10px;
  text-align: left;
}

.dep-table th {
  background: var(--md-surface-container-low);
  font-weight: 600;
}

.dep-table td:first-child {
  font-weight: 600;
  white-space: nowrap;
}

.dep-use {
  color: var(--md-on-surface-variant);
}

.about {
  font-size: 12px;
  color: var(--md-on-surface-variant);
  line-height: 1.8;
}
</style>
