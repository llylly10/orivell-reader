@echo off
rem ASCII only: cmd.exe parses batch files as GBK.
cd /d %~dp0
echo ================================================
echo  Orivell demo server (for the Android app)
echo  LAN URL: http://192.168.0.101:3101
echo  Keep this window open while using the app.
echo ================================================
npx next start --port 3101
