@echo off
cd /d "%~dp0"
set PATH=C:\Program Files\nodejs;%PATH%
echo 솔루션 검증이력 관리 시스템을 시작합니다...
echo 브라우저에서 http://localhost:4000 접속하세요.
node server.js
pause
