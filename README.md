# 简介 | Description
**这是一个用于批量下载视频/音频的软件，我们对它的用途预期如下：**
* **内置基于B站（别问为啥内置这个，因为太好用了OvO）的音视频多样下载功能：**
  * **批量下载音频/视频/音视频等**
  * **多线程下载（受制于B站限制，可能会失效，我们正在探索一条更加稳定的道路）**
* **基于B站的收藏夹下载功能**
* **非常MD3（Flutter）风的UI**
* **其他？（插件功能我们让AI做了，但是怎么样嘛...看AI发挥咯 awa）**

**This is a software used to download videos/audios，we expect it to be used in the following ways:**
* **Built-in diverse audio and video downloading features based on Bilibili (don’t ask why it’s built-in, it’s just too useful OvO):**
    * **Batch download audio/video/audio-video etc.**
    * **Multi-threaded downloads (subject to Bilibili restrictions, may fail, we are exploring a more stable way)**
* **Download videos from Bilibili collections**
* **Very MD3 (Flutter) styleUI based on Flutter**
* **Other features (we let AI do this, but how?...look at the AI play it), awa**

# AI创作声明 & 免责声明 | AI Creation Declaration & Disclaimer
**本软件包括但不限于以下部分使用了AI进行辅助（还是主导？）创作，但是以下列出的功能请谨慎使用，我们不对使用了以下功能而导致了各种恶性后果的情况负任何法律、道德及社会责任，请您在使用时保持谨慎：**
* **设置->系统->内存优化，这是效仿`PCL2`启动器的功能，用于优化内存使用，但是该功能全程由AI开发，人工目前未审核出该功能具有任何有效的破坏性，但是仍然请您谨慎使用**
* **下载->全量下载，该功能由人工+AI协同开发，这会从B站拉取相关视频/资源的弹幕、评论、点赞、收藏、转发等信息，这可能导致造成大量的您的IP地址对B站服务器造成大量的异常请求而被B站封禁，也可能使您的硬盘健康状况堪忧，因此请您谨慎使用，我们对使用此功能而造成的任何损失不承担任何责任**
* **批量下载（>=25个资源）：批量下载功能的避免封杀的机制由AI进行开发，我们不保证其完全有效，B站的接口也是日新月异的，因此我们不提倡一次性地下载超大量内容，如果您因使用该功能而导致了任何损失，我们不承担任何责任，多线程功能也请谨慎使用，B站本身对其是有限制的**

**以下是本软件其他功能的免责声明：**
**使用本软件其他功能，我们不对非正常使用导致的任何损失负任何法律、道德及社会责任，请您在使用时保持谨慎；但是我们会对合理使用本软件而造成损失的承担合理的责任**

**This software includes, but is not limited to, the following parts that use AI for assisted (or maybe even leading?) creation. However, please use the features listed below with caution. We are not responsible for any legal, moral, or social consequences that may arise from using these features, so please be careful when using them:**
* **Settings->System->Memory Optimization，this feature is developed by AI, and we have not found any effective damage to the system, but please be careful when using it**
* **Download->Full Download, this feature is developed by humans + AI, it will pull related video/resource bullet comments, comments, likes, favorites, forwards and other information from Bilibili, which may cause a large number of abnormal requests to the Bilibili server from your IP address and be banned by Bilibili, and may also make your hard drive health status worrying, so please use it with caution. We are not responsible for any loss caused by using this feature**
* **Batch Download (>=25 resources): The mechanism to avoid being banned for batch downloads is developed by AI, we do not guarantee its complete effectiveness, and Bilibili's interface is also changing rapidly. Therefore, we do not recommend downloading a large amount of content at once. If you suffer any loss due to using this feature, we are not responsible. Please use multi-threaded features with caution, as Bilibili itself has limitations on them**

**The disclaimer for the other features is as follows:**
**We are not responsible for any legal, moral, or social consequences that may arise from using these features. Please be careful when using them.**

# 开源协议 | Open Source License
| **遵循协议** | **相关组件** | **协议链接** | **组件开源链接** | **备注** |
| --- | --- | --- | --- | --- |
| **GPL-3.0-or-later** | **`FFmpeg`** | **[点击查看](https://gnu.net.cn/licenses/gpl-3.0.html)** | **[点击跳转](https://github.com/FFmpeg//FFmpeg)** | **`FFmpeg`是一个用于处理音视频的开源工具，我们使用它来进行合成音视频等操作** |
| **AGPL-3.0-or-later** | **来自未来的相关组件（人话：现在没有）** | **[点击查看](https://www.gnu.org/licenses/agpl-3.0.en.html)** | **[点击跳转](#开源协议--open-source-license)** | **未来提供 Web 服务形态（用户通过网络使用该软件）备用；桌面分发场景下与 GPL-3.0 差别不大** |
| **MIT** | **本软件不依赖其他已有协议组件而进行的独立开发的且可不依赖其他已有协议组件独立运作的组件** | **[点击查看](https://mit-license.org/)** | **[点击跳转](https://github.com/trae/trae)** | **Nothing is here** |

| **Protocols Followed** | **Related Components** | **License Links** | **Component Source Links** | **Remarks** |
| --- | --- | --- | --- | --- |
| **GPL-3.0-or-later** | **`FFmpeg`** | **[Click to View](https://gnu.net.cn/licenses/gpl-3.0.html)** | **[Click to Jump](https://github.com/FFmpeg//FFmpeg)** | **`FFmpeg` is a tool for processing audio and video files, we use it to compose audio and video files** |
| **AGPL-3.0-or-later** | **`Bilibili API`** | **[Click to View](https://www.gnu.org/licenses/agpl-3.0.en.html)** | **[Click to Jump](#开源协议--open-source-license)** | **We provide Web service for users to use the software over the network, and the desktop distribution scene is not much different from GPL-3.0** |
| **MIT** | **`Trae`** | **[Click to View](https://mit-license.org/)** | **[Click to Jump](https://github.com/trae/trae)** | **Nothing is here** |

# 版权信息 | Copyright Information
**版权所有 © 2026 [207研究所](apart207.top)**
**保留所有权利**

**Copyright 2026 [The 207th Research Institute](apart207.top)**
**All rights reserved.**

# i18n
**以上内容可能含有机翻、AI翻译内容而不准确，如果您有更好的翻译建议，请欢迎提交PR，我们欢迎您的贡献：）**<br>
**The above content may contain inaccurate machine translation or AI translation. If you have better translation suggestions, please feel free to submit a PR. We welcome your contributions :)**