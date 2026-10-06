import { createApp } from 'vue'

import App from './App.vue'
import './styles/index.css'
import { setupForegroundTracking } from './foreground'

// 前后台跟踪：后台播放策略依赖该状态，必须在挂载前就开始监听
setupForegroundTracking()

createApp(App).mount('#app')
