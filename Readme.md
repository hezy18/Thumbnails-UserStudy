视频浏览交互网页
1. 用户登录（数据库存储id和密码）
2. 登陆后有两个选项：User preference collection 和 thumbnail clicking and video viewing
3. User preference collection:  展示从100个视频，用户从中选择喜欢的并打分
4. Thumbnail clicking and video viewing：后台推荐该用户 10个 视频，依次展示该视频的6个thumbnail（来自不同方案，预先准备好）， 用户点击thumnail。 点击后导向视频，观看视频并给出评价问卷。返回上一步重新选择

三种运行方式：
1. vscode中安装 "Live Server" 插件，右键点击 index.html 选择 "Open with Live Server"。
2. run
python -m http.server 8000
http://localhost:8000
3. 安装 http-server 工具，运行命令 npx http-server

cookies清理
All users' data coexists in localStorage, keyed by user_id. If you ever need to wipe one user's data, run this in the browser console: 
let p = JSON.parse(localStorag e.getItem('preferences')); localStorage.setItem('preferences', JSON.stringify(p.filter(x => x.user_id!== 'P001')));