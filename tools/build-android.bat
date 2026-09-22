@echo off
REM Builds the Android debug APK from a SPACE-FREE path.
REM
REM React Native's Gradle plugin fails with "The filename, directory name, or
REM volume label syntax is incorrect" when the project path contains spaces
REM (this repo lives under "C:\Users\Aryan Kumar Singh\..."). C:\jalsakshi is
REM a directory junction to the repo, created with:
REM   New-Item -ItemType Junction -Path C:\jalsakshi -Target "<repo>"
REM Building through the junction gives Gradle a space-free path.

set "JAVA_HOME=C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot"
set "ANDROID_HOME=C:\Android\sdk"
set "PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%PATH%"

REM Absolute path, not a bare name: this shell does not resolve executables
REM from the current directory (NoDefaultCurrentDirectoryInExePath).
cd /d C:\jalsakshi\apps\mobile\android || exit /b 1
call C:\jalsakshi\apps\mobile\android\gradlew.bat app:assembleDebug -x lint -x test -PreactNativeArchitectures=x86_64 %*
exit /b %ERRORLEVEL%
