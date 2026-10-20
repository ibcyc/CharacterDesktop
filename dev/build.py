"""角色桌面打包腳本。

用法：雙擊最外層的 build.bat，或執行（在任何位置皆可）：
  python dev/build.py                    建置、更新本資料夾的 App、執行測試並產生發行 ZIP
  python dev/build.py --skip-tests       略過測試
  python dev/build.py --with-characters  另外用 Data 裡的角色跑擴充功能的隱藏測試
需要 Python 3.8+；第一次在沒有 CharacterDesktop.exe 的資料夾建置時，另需 Node.js（npm）與網路。

流程：
1. 由 dev/app（主程式與桌面角色頁）、dev/settings（設定頁）、dev/shared（兩頁共用）、dev/vendor 產生 resources/app。
2. 若還沒有 Electron 執行環境，自動在 dev/app 執行 npm ci 並下載 Electron，再同步到本資料夾（產生 CharacterDesktop.exe）。
3. dev/extensions 裡的每個擴充功能（若有）安裝到本資料夾的 Extensions/<id>，並各自打包成 CharacterDesktop-Extension-<id>.zip。
4. 只依白名單打包 App 本體，輸出 CharacterDesktop.zip，取代上一次的 ZIP。擴充功能只有 extension.json 寫了
   "withApp": true 的會預先裝在裡面（Extensions/<id>），其他的只有自己的 ZIP。
   Data（角色、設定、快取）、dev、其他擴充功能與既有 ZIP 一律不會進入 App 的發行檔，打包後再逐檔檢查。

版本號只需修改 dev/app/package.json 的 version。本專案以 MIT 授權（LICENSE）；擴充功能下載的角色素材屬於各自的權利人，不在授權範圍內。
"""
from pathlib import Path
import argparse,json,os,re,shutil,struct,subprocess,sys,tempfile,zipfile,zlib
sys.stdout.reconfigure(encoding='utf-8')
DEV=Path(__file__).resolve().parent;ROOT=DEV.parent
SOURCE=DEV/'app';SETTINGS=DEV/'settings';SHARED=DEV/'shared';VENDOR=DEV/'vendor';APP=ROOT/'resources'/'app'
EXTENSIONS=DEV/'extensions';INSTALLED=ROOT/'Extensions'
# Shared by both pages, in load order: rules, character kinds and the picture player.
SHARED_SCRIPTS=[SHARED/'character-rules.js',SHARED/'character-kinds.js',SHARED/'image-player.js']
# Settings page scripts, in load order; they share one script scope.
SETTINGS_SCRIPTS=SHARED_SCRIPTS+[SETTINGS/name for name in ('preview-controls.js','preview.js','dialog.js','character-panel.js','local-kind.js','desktop-panel.js','download-panel.js','local-panel.js','tuning-panel.js','expression-menu.js','sources-panel.js','ui-panel.js','install-panel.js','app-menu.js','groups-panel.js','tool-host.js','usage-meter.js','settings-app.js','motion.js')]
EXE='CharacterDesktop.exe'
# Files copied as-is into resources/app; pet.html, settings.html, icon.png and package.json are generated.
RUNTIME=['main.cjs','profiles.cjs','install.cjs','store.cjs','pet-window.cjs','preload.cjs','pet.js','local.cjs','pack.cjs','extensions.cjs','startup.cjs','self-test.cjs','test-helpers.cjs','fresh-self-test.cjs','preview-self-test.cjs','character-self-test.cjs']
# Electron runtime files at the App root (electron.exe is renamed to CharacterDesktop.exe).
# Electron's own LICENSE is kept as LICENSE.electron, beside the project's LICENSE (MIT).
ELECTRON_LICENSE='LICENSE.electron'
ELECTRON=['LICENSES.chromium.html','chrome_100_percent.pak','chrome_200_percent.pak','d3dcompiler_47.dll','dxcompiler.dll','dxil.dll','ffmpeg.dll','icudtl.dat','resources.pak','snapshot_blob.bin','v8_context_snapshot.bin','version','vk_swiftshader.dll','vk_swiftshader_icd.json','vulkan-1.dll']
FORBIDDEN_SUFFIXES={'.webp','.wasm','.zip','.log','.tmp'}
FORBIDDEN_NAMES={'library.json','settings.json'}
# Pages load nothing from the network; background workers a page makes itself (blob:) may run, without network either.
CSP="default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' data: blob:; worker-src blob:"

def version():return json.loads((SOURCE/'package.json').read_text(encoding='utf-8'))['version']
def extensions():return sorted(p for p in EXTENSIONS.iterdir() if (p/'extension.json').is_file()) if EXTENSIONS.is_dir() else []
# Extensions whose manifest says "withApp": true come preinstalled in the App's zip.
def with_app():return [p for p in extensions() if json.loads((p/'extension.json').read_text(encoding='utf-8')).get('withApp') is True]
def scripts(paths):return '\n'.join(path.read_text(encoding='utf-8') for path in paths).replace('</','<\\/')

def pet_html():
 return ('<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="'+CSP+'"><title>角色桌面</title>'
  '<style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;user-select:none}canvas{display:block;width:100%;height:100%;background:transparent;touch-action:none;cursor:grab}canvas:active{cursor:grabbing}#pet-image{position:absolute;pointer-events:none;transform-origin:50% 100%;-webkit-user-drag:none}</style></head>'
  '<body><canvas id="pet-canvas"></canvas><img id="pet-image" alt="" hidden><script>'+scripts(SHARED_SCRIPTS)+'</script><script src="pet.js"></script></body></html>')

def settings_html():
 shell=(SETTINGS/'page.html').read_text(encoding='utf-8')
 shell=shell.replace('<title>角色收藏播放器</title>','<title>CharacterDesktop</title><meta http-equiv="Content-Security-Policy" content="'+CSP+'">')
 # Bottom left, from the top: round buttons that extensions bring (with their panels, shown when they apply), the
 # download button (only with an extension that downloads) and the file button; each opens its panel to its right.
 download=('<div data-slot="dock"></div>'
  '<div class="dock-row"><button id="download-toggle" class="fab" type="button" aria-expanded="false" aria-controls="download-panel" title="下載角色" hidden><svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M11 4h2v9.2l3.6-3.6 1.4 1.4-6 6-6-6 1.4-1.4 3.6 3.6V4zM5 18h14v2H5z"/></svg></button>'
  '<section id="download-panel" class="download-panel" hidden><form id="download-form"><div class="row"><input id="download-url" type="url" aria-label="角色頁網址" placeholder="Paste link to download" required spellcheck="false">'
  '<button id="download-start" class="primary" type="submit">下載並加入</button>'
  '<button id="download-list" type="button" title="從 .txt 清單逐一下載（一行一個網址，# 開頭是註解）">清單</button><input id="download-list-file" type="file" accept=".txt,text/plain" hidden>'
  '<button id="download-help-toggle" class="icon-button" type="button" aria-expanded="false" aria-controls="download-help" title="可以下載的網站">?</button><button id="download-cancel" type="button" hidden>取消</button></div></form>'
  '<div id="download-help" class="local-help" hidden></div><progress id="download-progress" max="100" value="0"></progress><div id="download-status" role="status" aria-live="polite"></div></section></div>')
 # Local characters: the file button and its panel (pick a picture or a folder, name it, add it; ? explains the names).
 download+=('<div class="dock-row"><button id="local-toggle" class="fab" type="button" aria-expanded="false" aria-controls="local-panel" title="加入自己的圖片"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M3 6a1 1 0 0 1 1-1h5.2l2 2H20a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6zm8 4v2.5H8.5v2H11V17h2v-2.5h2.5v-2H13V10h-2z"/></svg></button>'
  '<section id="local-panel" class="download-panel" hidden>'
  '<div class="row"><button id="local-pick-file" type="button">單張圖片</button><button id="local-pick-folder" type="button">資料夾</button>'
  '<button id="local-pick-pack" type="button" title="匯入用右下角選單「匯出」做成的角色包（.cdpack）">角色包</button>'
  '<button id="local-help-toggle" class="icon-button" type="button" aria-expanded="false" aria-controls="local-help" title="檔名規則">?</button></div>'
  '<p id="local-help" class="local-help" hidden><b>d</b>：預設樣子（單張圖片會自動改名為 d）<br><b>e1、e2…</b>：表情（放在資料夾裡）<br>'
  '格式：png、webp、svg、gif（gif 會動）；其他檔名不會匯入。<br>匯入後存在 Data\\Local\\編號，原本的檔案不會變動。<br>'
  '<b>角色包</b>：匯入用右下角選單「匯出」做成的 .cdpack，角色的設定也一起還原；已經有的角色會問你要跳過或覆蓋。</p>'
  '<form id="local-form" hidden><p id="local-chosen" class="hint"></p><div class="row"><input id="local-name" type="text" aria-label="角色名稱" placeholder="角色名稱" maxlength="40" required spellcheck="false">'
  '<button id="local-add" class="primary" type="submit">加入</button></div></form>'
  '<div id="local-status" role="status" aria-live="polite"></div></section></div>')
 controls=('<div class="field"><label for="desktop-height">高度 <span id="desktop-height-label"></span></label><input id="desktop-height" type="range" min="180" max="1000" value="500"></div>'
  '<div class="field"><label for="desktop-opacity">透明度 <span id="desktop-opacity-label"></span></label><input id="desktop-opacity" type="range" min="1" max="100" value="100"></div>'
  # How often the character pokes itself; only while it is on the desktop.
  '<div class="field" id="autopoke-field" hidden><label for="desktop-autopoke">自動戳 <span id="desktop-autopoke-label"></span></label><input id="desktop-autopoke" type="range" min="0" max="600" step="10" value="180"></div>'
  '<div class="field"><button id="desktop-reset" title="把桌面角色移回畫面內，並讓預覽畫面歸位">找回角色</button></div>'
  '<div class="field" id="local-folder-field" hidden><button id="local-open" type="button">打開檔案所在位置</button></div>'
  '<div class="field" id="startup-field" hidden><label class="switch-row" for="desktop-startup"><span>開機自動啟動</span><input id="desktop-startup" class="switch" type="checkbox" role="switch"></label><p id="startup-status" role="status" aria-live="polite"></p></div>'
  # Characters on the desktop, front first; rows are dragged to change who covers whom.
  '<div class="field" id="layers-field" hidden><label id="layers-label">圖層 <span>拖曳調整，上方在最前面</span></label><ol id="layers" class="layers" aria-labelledby="layers-label"></ol></div>')
 visibility=('<input id="desktop-visible" class="switch visibility big" type="checkbox" role="switch" aria-label="這個角色顯示在桌面" title="這個角色顯示在桌面／移除" hidden>'
  '<button id="desktop-lock" class="icon-button lock" type="button" aria-pressed="false" title="鎖定位置（防止拖曳）" aria-label="鎖定位置" hidden></button>'
  # While a group is edited: the member being edited can leave it.
  '<button id="group-leave" type="button" hidden>從組合中移除</button>')
 for marker,html in (('<!--desktop-top-->',download),('<!--desktop-panel-->',controls),('<!--desktop-visible-->',visibility)):
  assert shell.count(marker)==1,marker
  shell=shell.replace(marker,html)
 # Theme and anime.js with its full MIT notice.
 shell=shell.replace('</style>',(SETTINGS/'theme.css').read_text(encoding='utf-8')+'</style>',1)
 anime=(VENDOR/'anime.umd.min.js').read_text(encoding='utf-8');assert '</script' not in anime.lower()
 shell=shell.replace('<!--vendor-scripts-->','<script>/*\n'+(VENDOR/'anime-LICENSE').read_text(encoding='utf-8').replace('*/','* /')+'*/\n'+anime+'</script>',1)
 assert shell.count('__APP__')==1
 return shell.replace('__APP__',scripts(SETTINGS_SCRIPTS))

def icon_png():
 def chunk(name,data):return struct.pack('>I',len(data))+name+data+struct.pack('>I',zlib.crc32(name+data)&0xffffffff)
 rows=[]
 for y in range(32):
  row=bytearray()
  for x in range(32):
   inside=(x-16)**2+(y-16)**2<210
   paw=((x-16)**2/32+(y-20)**2/22<1) or any((x-cx)**2+(y-cy)**2<8 for cx,cy in [(10,12),(16,9),(22,12)])
   row+=bytes((194,216,167,255) if paw else (30,54,35,255) if inside else (0,0,0,0))
  rows.append(b'\0'+row)
 return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',32,32,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(rows)))+chunk(b'IEND',b'')

def build_app(target):
 """Write a complete resources/app into target (an empty folder)."""
 target.mkdir(parents=True,exist_ok=True)
 for name in RUNTIME:shutil.copy2(SOURCE/name,target/name)
 (target/'pet.html').write_text(pet_html(),encoding='utf-8')
 (target/'settings.html').write_text(settings_html(),encoding='utf-8')
 (target/'icon.png').write_bytes(icon_png())
 package=json.loads((SOURCE/'package.json').read_text(encoding='utf-8'));package.pop('dependencies',None)
 (target/'package.json').write_text(json.dumps(package,ensure_ascii=False,indent=2),encoding='utf-8')

def install_app():
 (ROOT/'resources').mkdir(exist_ok=True)
 with tempfile.TemporaryDirectory(dir=ROOT/'resources') as stage:
  build_app(Path(stage)/'app')
  if APP.exists():shutil.rmtree(APP)
  shutil.move(str(Path(stage)/'app'),APP)
 # Electron only falls back to default_app.asar when resources/app is missing.
 (ROOT/'resources'/'default_app.asar').unlink(missing_ok=True)

# ---------- Extensions ----------
OTHER_PLATFORMS={'darwin','linux','arm64'}   # npm packages ship binaries for every platform; the App is Windows x64

def install_packages(folder):
 """An extension with a package.json gets its npm packages (its install scripts are not run)."""
 if not (folder/'package.json').is_file() or (folder/'node_modules').is_dir():return
 npm=shutil.which('npm')
 if not npm:sys.exit('擴充功能 '+folder.name+' 需要 Node.js（npm）安裝套件。')
 run([npm,'ci','--ignore-scripts','--no-audit','--no-fund'],cwd=folder,timeout=900)

def extension_files(folder,tests=False):
 """What an extension ships: everything but its tests and npm files; of node_modules only the packages its
 package.json lists under "bundle", without other platforms' binaries, type declarations, source maps and the file
 names it lists under "bundleExclude"."""
 meta=json.loads((folder/'package.json').read_text(encoding='utf-8')) if (folder/'package.json').is_file() else {}
 bundle,excluded=set(meta.get('bundle',[])),set(meta.get('bundleExclude',[]))
 def ships(path):
  parts=path.relative_to(folder).parts
  if parts[0] in ('package.json','package-lock.json') or ('tests' in parts and not tests):return False
  if parts[0]!='node_modules':return True
  return len(parts)>2 and parts[1] in bundle and not OTHER_PLATFORMS&set(parts) and path.name not in excluded and not path.name.endswith(('.d.ts','.map'))
 return sorted(p for p in folder.rglob('*') if p.is_file() and ships(p))

def copy_extension(folder,target,tests=False):
 """Makes target hold exactly what the extension ships. Unchanged files are left alone, so a running App that has
 one of them open (such as a runtime library) does not stop the build."""
 wanted={path.relative_to(folder):path for path in extension_files(folder,tests)}
 try:
  if target.exists():
   for old in sorted((p for p in target.rglob('*') if p.is_file()),reverse=True):
    if old.relative_to(target) not in wanted:old.unlink()
  for name,path in wanted.items():
   copy=target/name
   if copy.is_file() and copy.stat().st_size==path.stat().st_size and copy.read_bytes()==path.read_bytes():continue
   copy.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(path,copy)
 except PermissionError as error:sys.exit('無法更新 '+str(error.filename)+'，請先結束角色桌面再重新打包。')

def install_extensions():
 """Each extension in dev/extensions replaces its copy in this folder's Extensions/; others there stay."""
 for folder in extensions():
  install_packages(folder)
  copy_extension(folder,INSTALLED/folder.name)
  print('擴充功能：',folder.name,'→',INSTALLED/folder.name)

def sync_electron():
 package=SOURCE/'node_modules'/'electron';dist=package/'dist'
 if not package.is_dir() and not (ROOT/EXE).is_file():
  npm=shutil.which('npm')
  if not npm:sys.exit('找不到 Node.js（npm）。請先安裝 https://nodejs.org/ 再重新打包。')
  run([npm,'ci'],cwd=SOURCE,timeout=900)
 # npm does not fetch the Electron binary for this version; its install.js downloads it.
 if package.is_dir() and not dist.is_dir():run([shutil.which('node') or 'node',str(package/'install.js')],timeout=900)
 if not dist.is_dir():return
 print('同步 Electron 執行環境：',dist)
 for name in ELECTRON:shutil.copy2(dist/name,ROOT/name)
 shutil.copy2(dist/'LICENSE',ROOT/ELECTRON_LICENSE)
 try:shutil.copy2(dist/'electron.exe',ROOT/EXE)
 except PermissionError:sys.exit('無法更新 '+EXE+'，請先結束角色桌面再重新打包。')
 shutil.copytree(dist/'locales',ROOT/'locales',dirs_exist_ok=True)

def run(command,timeout=300,**options):
 print('>',' '.join(map(str,command)));subprocess.run(command,check=True,timeout=timeout,**options)

def node_command():
 """Node, or the Electron executable running as Node, with its environment."""
 if shutil.which('node'):return [shutil.which('node')],None
 return [str(ROOT/EXE)],{**os.environ,'ELECTRON_RUN_AS_NODE':'1'}

def self_test(flag,data,extensions_dir,timeout=300):
 """Runs one hidden self-test of the App and returns its report."""
 report=data.parent/(data.parent.name+'-report.json')
 print('> --self-test',flag,'（隱藏視窗）')
 code=subprocess.run([str(ROOT/EXE),'--self-test',flag,'--data-dir='+str(data),'--extensions-dir='+str(extensions_dir),'--report='+str(report)],timeout=timeout).returncode
 result=json.loads(report.read_text(encoding='utf-8')) if report.is_file() else {'error':'no report'}
 if code or not result.get('ok'):sys.exit(flag+' 測試失敗：'+str(result.get('error'))[:2000])
 return result

def run_tests():
 node,env=node_command()
 for test in sorted((DEV/'tests').glob('test-*.cjs')):run(node+[str(test)],env=env)
 for folder in extensions():
  for test in sorted((folder/'tests').glob('test-*.cjs')):run(node+[str(test)],env=env)
 # The App alone: every hidden test runs with an empty Extensions folder.
 with tempfile.TemporaryDirectory() as folder:
  folder=Path(folder);none=folder/'no-extensions';none.mkdir()
  # Start the first-use test from a settings.json full of keys no longer used: they must be dropped.
  (folder/'fresh'/'Data').mkdir(parents=True)
  (folder/'fresh'/'Data'/'settings.json').write_text(json.dumps({'storageVersion':1,'downloadRoot':'Characters','lastDownloadFolder':'Characters/old-role','height':310}))
  # The character test starts with a character of an extension that is not installed, on the desktop and being
  # edited when it was last saved: it must never show, and never be lost.
  (folder/'character'/'Data').mkdir(parents=True)
  (folder/'character'/'Data'/'library.json').write_text(json.dumps([{'id':'X1','extension':'elsewhere','name':'Hidden One','english':'Hidden','models':[]}]))
  (folder/'character'/'Data'/'settings.json').write_text(json.dumps({'selection':{'characterId':'X1','look':{'pose':1},'expression':'3'},'layers':['X1'],'pinned':['X1'],
   'characters':{'X1':{'look':{'pose':1},'expression':'3','heights':{'pose1':640},'mirror':True,'options':{'a':1},'desktop':{'shown':True,'locked':False,'opacity':70,'x':100,'y':100,'autoPoke':30}}}}))
  # Its files, and other data of its extension: the files go only with 重置並清空全部, the other data stays.
  for name in ('Characters/X1/picture.png','Engine/player.js'):
   (folder/'character'/'Data'/'Extensions'/'elsewhere'/name).parent.mkdir(parents=True,exist_ok=True);(folder/'character'/'Data'/'Extensions'/'elsewhere'/name).write_text('x')
  for flag,name in (('--fresh-library-test','fresh'),('--preview-controls-test','preview'),('--character-test','character')):
   result=self_test(flag,folder/name/'Data',none)
   if 'results' in result:print('App 測試通過：',len(result['results']),'項')
  # An unknown test name must be refused.
  report=folder/'unknown.json';print('> --self-test --no-such-test')
  code=subprocess.run([str(ROOT/EXE),'--self-test','--no-such-test','--data-dir='+str(folder/'unknown'/'Data'),'--extensions-dir='+str(none),'--report='+str(report)],timeout=120).returncode
  assert code==2 and not json.loads(report.read_text(encoding='utf-8')).get('ok'),'unknown self-test flag was not refused'

def run_extension_tests():
 """Each extension's hidden test, with characters from this folder's Data (its tests/prepare.cjs picks them): once
 with only that extension installed (it needs no other), and once with all of them (they get along)."""
 node,env=node_command()
 for folder in extensions():
  if not (folder/'tests'/'self-test.cjs').is_file():continue
  for together in ([False,True] if len(extensions())>1 else [False]):
   with tempfile.TemporaryDirectory() as temp:
    data=Path(temp)/folder.name/'Data';data.mkdir(parents=True)
    installed=EXTENSIONS if together else Path(temp)/'Extensions'
    if not together:copy_extension(folder,installed/folder.name,tests=True)
    if (folder/'tests'/'prepare.cjs').is_file():run(node+[str(folder/'tests'/'prepare.cjs'),str(ROOT/'Data'),str(data)],env=env)
    result=self_test('--extension-test='+folder.name,data,installed)
    print('擴充功能',folder.name,'（和其他擴充功能一起）' if together else '（單獨安裝）','測試通過：',len(result['results']),'項',json.dumps({k:v for k,v in result['results'].items() if v!='ok'},ensure_ascii=False))

# ---------- Release files ----------
def release_files():
 yield ROOT/EXE
 yield ROOT/'LICENSE'
 yield ROOT/ELECTRON_LICENSE
 for name in ELECTRON:yield ROOT/name
 for folder in (ROOT/'locales',APP):yield from sorted(p for p in folder.rglob('*') if p.is_file())

def extension_marks():
 """What would point to an extension in the App's own files: its id and the websites its manifest names."""
 marks=set()
 for folder in extensions():
  manifest=json.loads((folder/'extension.json').read_text(encoding='utf-8'))
  marks.add(folder.name.lower())
  marks.update(host.lower() for host in re.findall(r'[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+',str(manifest.get('site',''))))
 return sorted(marks)

def check_clean(names,read,app_only=True):
 preinstalled={'CharacterDesktop/Extensions/'+p.name+'/' for p in with_app()}
 for name in names:
  parts=name.split('/')
  if 'Data' in parts or 'dev' in parts or Path(name).suffix.lower() in FORBIDDEN_SUFFIXES or parts[-1] in FORBIDDEN_NAMES:
   raise SystemExit('發行檔含有不允許的檔案：'+name)
  # The App's zip holds no extension but those that come with it.
  if app_only and 'Extensions' in parts and not any(name.startswith(prefix) for prefix in preinstalled):raise SystemExit('App 發行檔不可包含這個擴充功能：'+name)
 # The App's own files name no extension, so it can be published without them.
 if app_only:
  marks=[mark.encode() for mark in extension_marks()]
  for name in names:
   if name.startswith('CharacterDesktop/resources/app/'):
    text=read(name).lower()
    for mark in marks:
     if mark in text:raise SystemExit('App 檔案提到擴充功能「'+mark.decode()+'」：'+name)

def write_zip(target,entries,app_only):
 temp=target.with_name('.'+target.name+'.partial')
 try:
  with zipfile.ZipFile(temp,'w',zipfile.ZIP_DEFLATED,compresslevel=6,strict_timestamps=False) as z:
   for path,name in entries:z.write(path,name)
  with zipfile.ZipFile(temp) as z:
   assert z.testzip() is None
   check_clean(z.namelist(),z.read,app_only)
 except BaseException:
  temp.unlink(missing_ok=True);raise
 target.unlink(missing_ok=True);temp.replace(target)
 print(target,'·',round(target.stat().st_size/1024/1024,1),'MB ·',len(entries),'個檔案')

def make_zips():
 files=list(release_files())
 missing=[str(p) for p in files if not p.is_file()]
 if missing:sys.exit('缺少 App 檔案：'+', '.join(missing))
 # Zips of earlier builds (CharacterDesktop-v0.2.x.zip, extensions no longer in dev/extensions) go first.
 for old in ROOT.glob('CharacterDesktop*.zip'):old.unlink()
 # Extensions that come with the App are in its zip as installed, in CharacterDesktop/Extensions/<id>/.
 preinstalled=[(p,'CharacterDesktop/Extensions/'+folder.name+'/'+p.relative_to(folder).as_posix()) for folder in with_app() for p in extension_files(folder)]
 write_zip(ROOT/'CharacterDesktop.zip',[(p,'CharacterDesktop/'+p.relative_to(ROOT).as_posix()) for p in files]+preinstalled,True)
 # An extension zip unpacks over the App folder into CharacterDesktop/Extensions/<id>/ (also those that come with
 # the App, to put one back or update it).
 for folder in extensions():
  write_zip(ROOT/('CharacterDesktop-Extension-'+folder.name+'.zip'),[(p,'CharacterDesktop/Extensions/'+folder.name+'/'+p.relative_to(folder).as_posix()) for p in extension_files(folder)],False)

if __name__=='__main__':
 parser=argparse.ArgumentParser(description='建置角色桌面並產生乾淨的發行 ZIP');parser.add_argument('--skip-tests',action='store_true');parser.add_argument('--with-characters',action='store_true',help="also run the extensions' hidden tests with characters from Data")
 args=parser.parse_args()
 print('角色桌面',version())
 sync_electron()
 if not (ROOT/EXE).is_file():sys.exit('找不到 Electron 執行環境，請確認網路連線後重新打包。')
 install_app()
 install_extensions()
 if not args.skip_tests:run_tests()
 if args.with_characters:run_extension_tests()
 make_zips()
