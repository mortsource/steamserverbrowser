# Server Browser+ for Steam

<p align="center">
    <img alt="GitHub Release" src="https://img.shields.io/github/v/release/mortsource/steamserverbrowser">
    <img alt="GitHub Downloads (all assets, all releases)" src="https://img.shields.io/github/downloads/mortsource/steamserverbrowser/total">
</p>

**Server Browser+** is a plugin for the native Steam game server browser. 

## World Map
Splits the native browser into two panes: a virtualized server list with images and a live Leaflet map, synced together. Servers are clustered by region and expand when zoomed. Filters and context menus behave as expected. Quick access tabs for popular games and removed dead games.

## Spam Filtering
This project was initially started due to Valve ignoring large spam networks flooding Counter-Strike even after being notified in various [GitHub issues](https://github.com/ValveSoftware/csgo-osx-linux/issues/2689). Filter logic sits between the callback to the server browser and add virtually zero overhead.

| Filter | Example |
|---|---|
| **REMOTE BLOCKLIST*** | `*.*.*.*/24, /sgaming.ru/i` |
| **PLAYER SPOOFING** | `255/255` | 
| **UNUSUAL PORT**| `x.x.x.x:5000` |
| **CYRILLIC** | `спам-сервер` |
| **EMOJIS** *off by default* | `🏆🏆🏆` |

*Updated automatically on startup or on-demand in settings

## Install
> [!WARNING]
> If you used the beta of this project, **pureBrowser**, make sure to delete it from your plugins to ensure it doesn't conflict

This project requires [Millennium aka SteamBrew](https://steambrew.app), a framework for Steam. It is used commonly for themes but also plugins, install is quick and simple. 

1. Go to [Millennium (SteamBrew)](https://steambrew.app), download and install.
<img src="./docs/readme_install1.png" width="500" style="padding-bottom: 30px">  

2. Download the latest [release](https://github.com/mortsource/steamserverbrowser/releases/latest) of the plugin, currently it is ![GitHub Release](https://img.shields.io/github/v/release/mortsource/steamserverbrowser). Extract the ZIP and paste the contents into your Steam installation likely at ```C:\Program Files (x86)\Steam```.
<img src="./docs/readme_install2.png" width="500" style="padding-bottom: 30px">

3. Restart Steam and go to Steam > Millennium in the top bar. Navigate to the 'Plugins' section and enable 'ServerBrowserPlus'. You will be prompted to restart again.
<img src="./docs/readme_install3.png" width="500">

*Slava Ukraini* 🇺🇦