/** 验证楼中楼 pn 翻页是否真的生效（跑完即删） */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
const H = { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', 'Accept-Language': 'zh-CN,zh;q=0.9', Origin: 'https://www.bilibili.com', Referer: 'https://www.bilibili.com/' }
async function j(url) { const r = await fetch(url, { headers: H }); return r.json() }

;(async () => {
  const v = await j('https://api.bilibili.com/x/web-interface/view?bvid=BV1gzynBWEye')
  const aid = v.data.aid
  const root = 281107327777 // 40 条回复的根评论

  const p1 = await j(`https://api.bilibili.com/x/v2/reply/reply?oid=${aid}&type=1&root=${root}&pn=1&ps=10`)
  const p2 = await j(`https://api.bilibili.com/x/v2/reply/reply?oid=${aid}&type=1&root=${root}&pn=2&ps=10`)
  const p3 = await j(`https://api.bilibili.com/x/v2/reply/reply?oid=${aid}&type=1&root=${root}&pn=3&ps=10`)
  const ids = (r) => (r.data?.replies ?? []).map((x) => x.rpid)
  console.log('pn=1:', ids(p1).slice(0, 3), '... 共', ids(p1).length, '| page:', JSON.stringify(p1.data?.page))
  console.log('pn=2:', ids(p2).slice(0, 3), '... 共', ids(p2).length)
  console.log('pn=3:', ids(p3).slice(0, 3), '... 共', ids(p3).length)
  const s1 = new Set(ids(p1))
  const s2 = new Set(ids(p2))
  console.log('1/2 页重复 =', ids(p2).filter((x) => s1.has(x)).length)
  console.log('2/3 页重复 =', ids(p3).filter((x) => s2.has(x)).length)
  console.log('结论: pn 翻页', ids(p2).filter((x) => s1.has(x)).length === 0 ? '可用 ✅' : '不可用 ❌')
})().catch((e) => console.log('异常:', e.message))
