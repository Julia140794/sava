import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright
out=Path('/workspace/sava/content/previews');out.mkdir(exist_ok=True)
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  errors=[]
  for w,h in [(1440,900),(1920,1080),(390,844),(320,640)]:
   page=await browser.new_page(viewport={'width':w,'height':h},reduced_motion='reduce')
   page.on('pageerror',lambda err:errors.append(str(err)))
   response=await page.goto('http://127.0.0.1:3000',wait_until='networkidle')
   await page.evaluate('document.fonts.ready')
   assert response.status==200
   assert await page.locator('h1').count()==1
   assert await page.locator('html').get_attribute('lang')=='ru'
   assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth'),f'Overflow {w}'
   await page.evaluate('Promise.all(Array.from(document.images).map(i=>{i.loading="eager";return i.decode()}))')
   assert await page.evaluate('Array.from(document.images).every(i=>i.complete && i.naturalWidth>0)'),f'Images {w}'
   assert await page.evaluate("document.fonts.check('400 16px Manrope')"),'Font not loaded'
   for s in await page.locator('script[type="application/ld+json"]').all_text_contents():json.loads(s)
   await page.screenshot(path=str(out/f'desktop-{w}.png' if w>700 else out/f'mobile-{w}.png'),full_page=True)
   await page.screenshot(path=str(out/f'first-screen-{w}.png'),full_page=False)
   if w<=700:
    await page.get_by_role('button',name='Открыть меню').click()
    assert await page.locator('#mobile-nav').is_visible()
    await page.locator('#mobile-nav').get_by_role('link',name='Услуги',exact=True).click()
    assert not await page.locator('#mobile-nav').is_visible()
   await page.locator('.service-row').nth(1).get_by_role('link').click()
   assert await page.locator('#service').input_value()=='manicure'
   await page.locator('.service-row').nth(2).get_by_role('link').click()
   assert await page.locator('#service').input_value()=='pedicure'
   await page.get_by_role('link',name='Хочу на массаж лица').click()
   assert await page.locator('#service').input_value()=='face'
   detail=page.locator('details').first
   await detail.locator('summary').click()
   assert await detail.get_attribute('open') is not None
   assert await page.get_by_role('button',name='Запись скоро откроется').is_disabled()
   print(json.dumps({'viewport':[w,h],'status':'PASS','overflow':False,'images':'loaded','service_selection':'PASS','menu':'PASS' if w<=700 else 'desktop','faq':'PASS','intake':'disabled'},ensure_ascii=False))
   await page.close()
  page=await browser.new_page(java_script_enabled=False)
  await page.goto('http://127.0.0.1:3000',wait_until='networkidle')
  assert await page.get_by_role('heading',level=1).is_visible()
  assert await page.locator('.service-row').count()==3
  print('Server HTML without JavaScript: PASS')
  for path,status in [('/privacy',200),('/robots.txt',200),('/sitemap.xml',200),('/llms.txt',200),('/opengraph-image',200),('/missing-page',404)]:
   res=await page.request.get('http://127.0.0.1:3000'+path)
   assert res.status==status,(path,res.status)
   print(path, res.status)
  base={'name':'Проверка','phone':'+375291234567','service':'face','consent':True,'comment':'Проверка','website':''}
  for title,data,status in [('missing fields',{},400),('invalid phone',{**base,'phone':'abc'},400),('no consent',{**base,'consent':False},400),('bad service',{**base,'service':'other'},400),('oversize comment',{**base,'comment':'x'*1001},400),('honeypot',{**base,'website':'spam'},200),('not configured',base,503)]:
   res=await page.request.post('http://127.0.0.1:3000/api/lead',data=data)
   assert res.status==status,(title,res.status,await res.text())
   print('API',title, res.status,'PASS')
  res=await page.request.post('http://127.0.0.1:3000/api/lead',data=base,headers={'Origin':'https://elsewhere.invalid'})
  assert res.status==403
  print('API cross origin 403 PASS')
  assert not errors,errors
  print('Browser runtime errors: none')
  await browser.close()
asyncio.run(main())
