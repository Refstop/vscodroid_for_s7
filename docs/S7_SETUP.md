# Galaxy Tab S7 작업 환경 이전

이 소스는 upstream `rmyndharis/VSCodroid` 커밋 `b818d7a`에 [세션 변경 사항](../CHANGELOG.md)을 적용한 작업본이다. 대상 저장소는 `Refstop/vscodroid_for_s7`이며, 새 PC에서는 이 변경이 push된 브랜치를 checkout해야 한다. upstream의 APK만 설치하면 이 변경들은 포함되지 않는다.

## 현재 최종본과 push 준비

최종본은 **versionCode 22 / 1.6.0-debug**이다. APK 21의 SSH 연결 요청 오류를 수정한 버전이며, 2026-11-08 태블릿에 설치하고 기존 워크스페이스 복원과 PC SSH 에이전트 사용을 확인했다. APK 18~21의 기능은 모두 이 버전에 포함된다.

- 소스 push 대상: Git에 추적된 파일과 새 소스·테스트·문서. `git status --short`와 `git diff --check`로 확인한다.
- 로컬 배포물: `artifacts/s7-final/vscodroid-s7-final-debug.apk`, `SHA256SUMS`, 최종 빌드·QA·소스 해시 기록. 이 디렉터리는 Git에서 제외한다.
- 재생성 가능한 `android/app/build`, `android/.gradle`, `android/.kotlin`과 임시 진단 로그는 정리했다. APK에 필요한 내려받은 런타임 자산은 현재 PC의 재빌드를 위해 남기되 Git에서는 제외한다.
- 회귀 테스트와 `probe/` 테스트 확장은 최종 기능 검증에 필요하므로 보존한다. APK에는 테스트 확장을 넣지 않는다.

이전 대상은 **`Refstop/vscodroid_for_s7`**, 최종본 브랜치는 **`s7/remote-workspace-apk22`**이다. 새 PC에서는 아래 명령으로 clone한다. 원본 작업 디렉터리 `VSCodroid`의 `origin`은 upstream을 가리킬 수 있으므로 작업 위치를 옮길 때는 `git remote -v`로 확인한다. `.git` 디렉터리나 개인별 설정을 덮어 복사하지 않는다.

```sh
git clone --branch s7/remote-workspace-apk22 https://github.com/Refstop/vscodroid_for_s7.git
cd vscodroid_for_s7
```

## 남겨야 하는 구성

| 구성 | 위치 | 역할 |
| --- | --- | --- |
| Android 앱과 브라우저 확장 소스 | `android/app/src/main/` | SSH 원격 워크스페이스, Quick Input, 마지막 폴더 복원, 키보드/IME, Tailscale 설정 |
| 서버 패치와 빌드 입력 | `patches/`, `branding/`, `scripts/`, 버전·해시 고정 파일 | Code OSS 및 Android 런타임 재구성 |
| APK 내장 원격 준비 도구 | `scripts/remote-workspace/setup-remote.cjs`, `scripts/codex-extension/` | SSH 연결 시 확장 설치, Codex 웹뷰·키보드·큐·HTML 패치 및 기본 설정 |
| 최종 구현 검증 소스 | `scripts/remote-workspace/`, `scripts/keyboard/`, `android/app/src/test/` | 회귀 검사. `probe/`는 테스트용 확장이며 배포 APK에 포함되지 않음 |
| 개인별 준비 | 아래 설치 절차 | Codex 로그인, SSH 호스트, Tailscale, 물리 키보드 언어 |

APK와 내려받은 런타임, `node_modules`, 빌드 캐시 및 개인 설정은 Git 대상이 아니다. 로컬 최종 APK는 `artifacts/s7-final/`에 두며, GitHub로 배포할 때는 소스 push와 별도로 Release 첨부파일을 사용한다. 기존 디버그 앱을 데이터 보존 업데이트하려면 동일한 서명 키가 필요하므로 키는 비공개 경로로 별도 이전한다. 키·비밀번호·토큰은 저장소에 넣지 않는다.

## 새 PC에서 앱 빌드

1. 대상 브랜치를 clone하고 JDK(컴파일러 `javac` 포함), Android SDK/NDK, Node, Python 및 도구를 준비한다. 검증한 로컬 빌드는 JDK 21을 사용했다. SDK/NDK 버전과 전체 자산 준비 순서는 [CONTRIBUTING.md](../CONTRIBUTING.md#preparing-assets)에 있다.
2. `JAVA_HOME`은 JDK 디렉터리, `ANDROID_HOME`은 새 PC의 SDK 디렉터리로 지정한다. 기존 PC의 절대 경로가 들어 있는 `local.properties`는 복사하지 않는다.
3. 최초에는 `./scripts/build-all.sh`로 필요한 바이너리·확장·번역 자산을 준비하고 빌드한다. 이미 준비한 자산이 있다면 다음 명령으로 앱을 빌드한다.

   ```sh
   cd android
   ./gradlew :app:assembleDebug
   ```

4. 산출물은 `android/app/build/outputs/apk/debug/app-debug.apk`이다. 디버그 패키지 ID는 `com.vscodroid.debug`이며, 실험용 앱 이름 오버레이는 제거했다.

빌드한 APK에는 최신 `server.js`, `remote-workbench.js`, `remote-workspace.sh`, `hardware-keyboard.js`와 `vscodroid-saf-bridge` 확장이 포함된다. 이전 세션에서 수행한 ADB 파일 덮어쓰기나 DevTools 주입을 다시 할 필요가 없다. versionCode 18부터 원격 준비 도구 `remote-compat.bin`도 APK에 포함하며, SSH 연결 시 자동으로 전달·실행한다. 별도의 PC 패치 명령은 필요하지 않다.

## 연결이 끊긴 뒤 복구

네트워크가 복구된 뒤 **Developer: Reload Window**를 실행한다. SSH transport가 살아 있으면 그대로 재사용하고, 종료됐다면 기존 편집기 안의 비밀번호 입력창으로 동일 호스트에 재연결한다. 비밀번호는 저장하지 않는다. 입력을 취소하면 나중에 창을 다시 로드해 재시도할 수 있다. 호스트 정보가 삭제됐거나 다른 호스트가 활성화됐으면 명시적으로 호스트를 다시 선택한다.

재연결은 파일과 워크스페이스 구성을 다시 여는 동작이다. 종료된 원격 에이전트의 터미널 작업을 되살리는 기능은 아니다. 원인 조사에는 Android 앱의 `files/remote-ssh/session.log`, 원격 호스트의 `~/.local/share/vscodroid-remote/oss-data/data/logs`, 해당 시각의 네트워크 로그를 함께 사용한다. 앱이 실행 중일 때 APK를 덮어 설치하면 현재 작업이 끊기므로 사용자와 종료 시점을 맞춘다.

## 원격 호스트와 확장 자동 준비

- Linux x64/ARM64 glibc 호스트에 SSH 서버, `curl`, `tar`, `sha256sum`, `base64`, `setsid`가 필요하다. 앱의 **Remote-SSH: Connect to Host...**에서 사용자·호스트·폴더를 지정한다.
- 최초 연결 시 해시가 고정된 Code OSS/런타임, **Simple HTML Viewer 0.1.0**, **Codex 26.1021.22027**을 준비한다. Node와 npm을 원격 PC에 따로 설치하지 않아도 된다. APK에 내장된 도구가 원격 에이전트의 Node를 사용한다.
- Codex 설치와 최초 웹뷰 번들 생성에는 인터넷과 여유 메모리가 필요하며 몇 분 걸릴 수 있다. 최초 생성 이후에는 결과를 검증하고 필요한 패치만 적용한다. 기존 Codex의 버전이 다르거나 다운로드·검증에 실패하면 SSH 워크스페이스는 열고, 자동 준비 실패 알림을 표시한다. 다른 버전으로 임의 다운그레이드하지 않는다.
- 자동 적용 범위는 Codex 웹뷰 호환성, Enter 전송, Shift+Enter 줄바꿈, 한글 조합 보호, 큐의 owner 전달, HTML 링크의 기본 편집기 사용이다. HTML/HTM 기본 연결은 원격 사용자 설정에 없을 때만 추가한다. 기존 설정·주석과 사용자가 나중에 선택한 기본 편집기는 유지한다.
- **Codex 로그인과 SSH 인증은 사용자가 진행한다.** 계정·토큰·비밀번호나 생성된 Codex 코드가 APK 또는 Git 소스에 포함되는 것은 아니다.
- 사용자 데이터는 `~/.local/share/vscodroid-remote/oss-data`, 확장은 `~/.local/share/vscodroid-remote/oss-extensions`에 저장한다. 자동화 도구와 다운로드 캐시는 `~/.cache/vscodroid-remote`에 둔다. 기존 프로젝트 파일은 별도로 이전한다.
- HTML의 상대 경로 이미지·CSS·JS를 읽으려면 해당 폴더를 워크스페이스로 연다. 소스를 편집하려면 **Reopen Editor With... → Text Editor**를 선택한다.

패치를 수동으로 재검사하거나 복원해야 할 때만 [Codex 패치 안내](../scripts/codex-extension/README.md)의 명령을 사용한다. 원격 확장 호스트가 실행된 후 설치·업데이트한 확장에는 다음 SSH 연결 시 자동 준비가 적용된다.

## 태블릿 설정

- Tailscale에 회사 계정으로 로그인하고 필요한 기기 승인 및 Android VPN 권한을 받는다. 접속 대상은 각자의 MagicDNS 호스트 이름으로 설정한다. 이전 PC의 IP·태블릿 ADB 포트·페어링 코드는 재사용하거나 소스에 넣지 않는다.
- VSCodroid 설정에서 `Tailscale`을 검색해 **Auto Connect**를 켜거나 끈다. 신규 설치 기본값은 꺼짐이다. 켠 상태에서는 편집기 서비스 시작 시 연결, 명시적 중지/최근 앱 제거 시 해제를 요청한다. 끄는 즉시 현재 VPN을 해제하지는 않는다.
- Samsung 물리 키보드 설정에 한국어 입력 언어를 추가하고 한/영 전환을 설정한다. 물리 키보드 사용 중 **화면 키보드 표시**와 Samsung의 **물리 키보드 도구 모음**은 꺼 둔다. 이는 Android 기기 설정이며 앱이 대신 배포하는 값이 아니다.
- 마지막 원격 폴더는 복원되지만 새 SSH 세션의 비밀번호는 매번 입력한다. 명시적으로 원격 연결을 닫으면 다음 실행 때 자동 복원하지 않는다.

## 검사

다음 검사는 앱을 종료하거나 태블릿 파일을 변경하지 않는다.

```sh
node scripts/remote-workspace/test-remote-setup.cjs
node scripts/remote-workspace/test-quick-input.js
node scripts/remote-workspace/test-tailscale-setting.js
node scripts/remote-workspace/test-ui-extension-cache.js
node scripts/codex-extension/test-keyboard.cjs
node scripts/test-server-bootstrap.js
```

`scripts/keyboard/test-hardware-keyboard.cjs`는 별도로 설치한 Playwright와 Chromium을 사용한다. `NODE_PATH`에 Playwright의 `node_modules` 경로를 지정하고, 필요한 경우 `CHROMIUM_PATH`에 Chromium 실행 파일 경로를 지정한다. 이 검사는 별도 headless 브라우저에서 실행된다.

`test-queue.cjs`는 실제 설치된 고정 버전 Codex 확장 경로를 인수로 받는다. `verify-*` 스크립트는 연결된 기기와 별도 Playwright/websocket-client 등 검사 도구가 필요하며 파일 상단의 조건을 먼저 확인한다. 특히 `verify-reload.py`와 `verify-codex.cjs --reload`는 편집기를 다시 로드하므로 현재 대화 실행 중에는 사용하지 않는다.

최종 APK 22는 2026-11-08 실기기에서 설치·재연결까지 확인했다. 관련 Android 단위 검사 31개와 SSH UI 회귀 검사가 통과했다. APK 내 원격 도구 16개와 UI 소스의 일치 여부도 확인했다. 정리 작업은 실행 중인 태블릿 앱이나 원격 PC의 사용자 데이터에 영향을 주지 않는다.

전체 Android 테스트 스위트는 완전 통과 상태가 아니다. 별도의 `NavigationTokenLoggingTest` 1건, `BridgeApiSpecParityTest` 1건, `BridgeTokenUniformityTest` 2건이 실패한 실행을 중단했다. 이 항목들은 이번 SSH 연결 수정의 통과 검사 31개와 별개이며 미해결 상태로 남아 있다.

2026-11-08 통합 빌드는 빈 Linux x64 HOME에서 실제 HTML Viewer/Codex 다운로드·설치·번들·패치 및 재접속 시 재사용을 검증했다. 새로 준비된 Codex에서 DOM Shift+Enter/Enter, IME 보호, 큐, HTML 열기 회귀 검사도 통과했다. 이후 APK 22에서 태블릿 업데이트·원격 워크스페이스 복원도 확인했다.


## 원격 PC에 이미 등록된 SSH 키 사용

`ssh -A`는 접속하는 기기의 에이전트를 원격으로 전달한다. 원격 PC의 기존 데스크톱 에이전트를 사용하려면 그 PC에서 `SSH_AUTH_SOCK`을 원격 셸에도 전달한다. GNOME keyring을 쓰는 PC에서는 `~/.bashrc`의 비대화형 `return`보다 앞에 다음을 둘 수 있다. 기존/forwarded 에이전트가 지정됐다면 유지하며, 실제 소켓과 소유자를 확인한다.

```sh
if [ -z "${SSH_AUTH_SOCK:-}" ]; then
    _vscodroid_agent_sock="/run/user/$(id -u)/keyring/ssh"
    if [ -S "$_vscodroid_agent_sock" ] && [ -O "$_vscodroid_agent_sock" ]; then
        export SSH_AUTH_SOCK="$_vscodroid_agent_sock"
    fi
    unset _vscodroid_agent_sock
fi
```

다른 에이전트는 해당 PC의 실제 소켓 경로를 사용한다. 새 원격 터미널에서 `ssh-add -l`로 확인한다. 이미 실행 중인 확장 호스트에는 환경 변수가 소급 적용되지 않으므로 SSH를 다시 연결한다. 이 설정은 원격 PC에 보관되며 APK에는 개인 키·계정 정보를 넣지 않는다.

명령 팔레트는 기본적으로 최근 50개 명령을 표시한다. versionCode 20부터 실행 직후 기록을 저장한다. `Remote-SSH: Connect to Host...`를 한 번 실행하면 이후 Ctrl+Shift+P에서 최근 명령으로 선택할 수 있다.

### SSH 명령 옵션과 Git 인증 (최종 APK 22)

Use **Remote-SSH: Add New SSH Host** with e.g. `ssh -A -p 2222 -o ServerAliveInterval=30 dev@host`. **Configure SSH Hosts** edits the tablet's `~/.ssh/config` inside the same editor. Settings are applied on the next connection. Supported options are listed in CHANGELOG.md; proxy commands and Include/Match are not supported.

`ForwardAgent yes` sends a tablet agent to the PC; it does not select the PC's own keys. To reuse the PC's desktop SSH agent, retain the existing `.bashrc` agent inheritance and use a Git SSH URL such as `git@github.com:OWNER/REPO.git`. HTTPS remotes still use their HTTPS credential helper. Forwarding requires a running tablet agent (`IdentityAgent /absolute/socket/path` or an inherited `SSH_AUTH_SOCK`); no keys are created or copied automatically.
