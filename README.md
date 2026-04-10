# GS에너지 PC 자산관리 시스템

GS에너지, GS파워, 인천종합에너지 3개 사업장의 PC 자산을 통합 관리하는 웹 애플리케이션입니다.
대시보드를 통해 전체 자산 현황을 한눈에 파악하고, 자산 등록/수정/삭제, 엑셀 일괄 업로드, 교체 검토 기준 관리 등의 기능을 제공합니다.

---

## 기술 스택

| 구분 | 기술 | 비고 |
|------|------|------|
| Backend | Python 3.12, Flask 3.1.3 | Werkzeug 3.1.3 |
| Database | Supabase PostgreSQL | psycopg 3.3.3 (psycopg[binary]) |
| Frontend | Vanilla JavaScript SPA | 단일 HTML 파일 내 인라인 CSS/JS |
| 엑셀 처리 | SheetJS (xlsx.full.min.js) | 클라이언트 사이드 `.xlsx` 파싱 |
| 인증 | Flask 세션 기반 | werkzeug.security 비밀번호 해싱 |
| 배포 | Vercel Serverless | @vercel/python 빌더 |

---

## 프로젝트 구조

```
gs-pc-asset-management/
├── app.py                          # Flask 서버 (API 엔드포인트 + DB 초기화)
├── requirements.txt                # Python 패키지 목록 (flask, psycopg, werkzeug)
├── vercel.json                     # Vercel 배포 설정 (라우팅 규칙)
├── .vercelignore                   # Vercel 배포 시 제외할 파일 목록
├── .env                            # 환경변수 (SECRET_KEY, DATABASE_URL) ※ Git 제외
├── .gitignore                      # Git 추적 제외 파일 목록
├── templates/
│   └── index.html                  # 단일 페이지 앱 (SPA) — HTML/CSS/JS 인라인 포함
├── static/
│   ├── xlsx.full.min.js            # SheetJS 라이브러리 (엑셀 파싱용)
│   └── css/                        # CSS 디렉토리 (현재 비어 있음, 스타일은 index.html 내 인라인)
└── vendor/                         # Flask 및 의존 라이브러리 내장 (오프라인 환경용)
    ├── flask/                      # Flask 3.1.3
    ├── psycopg/                    # psycopg 3 (PostgreSQL 드라이버)
    ├── psycopg_binary/             # psycopg 바이너리 모듈
    ├── werkzeug/                   # Werkzeug (WSGI 유틸리티)
    ├── jinja2/                     # Jinja2 템플릿 엔진
    ├── click/                      # Click (CLI 프레임워크)
    ├── markupsafe/                 # MarkupSafe (HTML 이스케이프)
    ├── itsdangerous/               # ItsDangerous (서명/토큰)
    ├── blinker/                    # Blinker (시그널 라이브러리)
    └── colorama/                   # Colorama (터미널 컬러)
```

### 주요 파일 설명

- **`app.py`** — 애플리케이션의 핵심 파일. Flask 앱 생성, DB 연결 관리, 인증 데코레이터(`login_required`, `admin_required`), 모든 REST API 엔드포인트, DB 초기화(`init_db`) 함수가 포함되어 있습니다. `.env` 파일을 자체 파싱하여 환경변수를 로드합니다 (python-dotenv 미사용).
- **`templates/index.html`** — 프론트엔드 전체를 담당하는 단일 HTML 파일. CSS 스타일과 JavaScript 로직이 모두 인라인으로 포함된 SPA(Single Page Application) 구조입니다. Pretendard 웹폰트를 사용합니다.
- **`static/xlsx.full.min.js`** — SheetJS 라이브러리. 엑셀 파일(`.xlsx`)을 브라우저에서 직접 파싱하여 JSON으로 변환합니다.
- **`vendor/`** — 인터넷이 제한된 사내 환경에서도 실행 가능하도록 pip 패키지를 직접 포함한 폴더. `app.py` 첫 줄에서 `sys.path`에 추가됩니다.

---

## 로컬 개발 환경 설정

### 사전 요구사항

- **Python 3.12** 이상 (psycopg 3는 Python 3.10+ 필요)
- Supabase 프로젝트 또는 PostgreSQL 데이터베이스

### 1. 저장소 클론 및 가상환경 생성

```bash
git clone <저장소-URL>
cd gs-pc-asset-management

# 가상환경 생성 및 활성화
python3 -m venv .venv
source .venv/bin/activate        # macOS/Linux
# .venv\Scripts\activate         # Windows
```

### 2. 패키지 설치

```bash
pip install -r requirements.txt
```

`requirements.txt` 내용:
```
flask==3.1.3
psycopg[binary]==3.3.3
werkzeug==3.1.3
```

> 참고: `vendor/` 폴더에 패키지가 내장되어 있으므로, 인터넷이 없는 환경에서는 pip 설치 없이도 실행 가능합니다.

### 3. 환경변수 파일 설정

프로젝트 루트에 `.env` 파일을 생성합니다:

```
SECRET_KEY=여기에_랜덤_문자열_입력
DATABASE_URL=postgresql://user:password@host:port/dbname
```

| 변수명 | 설명 | 필수 |
|--------|------|------|
| `SECRET_KEY` | Flask 세션 암호화에 사용되는 비밀 키. 랜덤 문자열로 설정 | 필수 |
| `DATABASE_URL` | PostgreSQL 연결 문자열 (Supabase 등) | 필수 |

> `.env` 파일은 `.gitignore`에 포함되어 있으므로 Git에 커밋되지 않습니다.
> 두 값 모두 미설정 시 서버 시작 시 `RuntimeError`가 발생합니다.

### 4. 서버 실행

```bash
python app.py
```

서버가 시작되면 브라우저에서 접속합니다:

```
http://localhost:5000
```

> **macOS 주의사항**: macOS Monterey 이후 기본적으로 포트 5000이 AirPlay Receiver와 충돌합니다.
> 이 경우 `시스템 설정 > 일반 > AirDrop 및 Handoff > AirPlay Receiver`를 비활성화하거나,
> `app.py`의 마지막 줄에서 포트를 변경하세요:
> ```python
> app.run(debug=False, port=5001)
> ```

---

## 기본 계정

최초 실행 시 `init_db()` 함수가 아래 기본 계정을 자동 생성합니다:

| 아이디 | 비밀번호 | 권한 | 설명 |
|--------|----------|------|------|
| `admin` | `admin1234` | 관리자 (`admin`) | 등록, 수정, 삭제, 엑셀 업로드, 설정 변경 가능 |
| `user` | `user1234` | 일반 (`user`) | 조회 전용 (읽기만 가능) |

> 운영 환경에서는 최초 로그인 후 비밀번호를 반드시 변경하세요.

---

## API 엔드포인트 목록

### 인증 API

| 메서드 | 경로 | 설명 | 인증 |
|--------|------|------|------|
| `POST` | `/api/auth/login` | 로그인 (username, password) | 불필요 |
| `POST` | `/api/auth/logout` | 로그아웃 (세션 삭제) | 불필요 |
| `GET` | `/api/auth/me` | 현재 로그인 사용자 정보 조회 | 불필요 |

### 설정 API

| 메서드 | 경로 | 설명 | 인증 |
|--------|------|------|------|
| `GET` | `/api/settings` | 시스템 설정 조회 (교체 검토 기준 연수 등) | 로그인 필요 |
| `PUT` | `/api/settings` | 시스템 설정 변경 (`replace_years` 등) | 관리자 전용 |

### 자산 API

| 메서드 | 경로 | 설명 | 인증 |
|--------|------|------|------|
| `GET` | `/api/assets` | 자산 목록 조회 (검색, 필터, 연식 필터 지원) | 로그인 필요 |
| `POST` | `/api/assets` | 자산 신규 등록 | 관리자 전용 |
| `GET` | `/api/assets/<id>` | 특정 자산 상세 조회 | 로그인 필요 |
| `PUT` | `/api/assets/<id>` | 특정 자산 수정 | 관리자 전용 |
| `DELETE` | `/api/assets/<id>` | 특정 자산 삭제 | 관리자 전용 |
| `POST` | `/api/assets/bulk` | 엑셀 일괄 업로드 (S/N 기준 중복 체크, 덮어쓰기 옵션) | 관리자 전용 |

### 필터 API

| 메서드 | 경로 | 설명 | 인증 |
|--------|------|------|------|
| `GET` | `/api/filters/departments` | 부서명 목록 (DISTINCT) | 로그인 필요 |
| `GET` | `/api/filters/makers` | 제조사 목록 (DISTINCT) | 로그인 필요 |
| `GET` | `/api/filters/models` | 모델명 목록 (DISTINCT, `?제조사=` 파라미터로 필터 가능) | 로그인 필요 |

### 대시보드 API

| 메서드 | 경로 | 설명 | 인증 |
|--------|------|------|------|
| `GET` | `/api/dashboard` | 대시보드 통계 (전체 수량, 사업장별/상태별/제조사별/기기종류별/연식별 집계) | 로그인 필요 |

### 자산 목록 조회 쿼리 파라미터

`GET /api/assets`에서 사용할 수 있는 필터 파라미터:

| 파라미터 | 설명 | 예시 |
|----------|------|------|
| `search` | 통합 검색 (사용자명, 부서명, 모델명, 시리얼번호, 사번, 이메일, 자산번호) | `?search=김` |
| `사업장` | 사업장 필터 | `?사업장=GS에너지` |
| `상태` | 상태 필터 | `?상태=사용중` |
| `기기종류` | 기기종류 필터 | `?기기종류=노트북` |
| `제조사` | 제조사 필터 | `?제조사=LENOVO` |
| `부서명` | 부서명 필터 | `?부서명=경영지원팀` |
| `old_years` | N년 이상 경과 자산 필터 | `?old_years=5` |
| `age_range` | 연식 구간 필터 (`lt1`, `1to2`, `2to3`, `3to5`, `gt5`) | `?age_range=gt5` |

---

## DB 스키마

### assets 테이블

PC 자산 정보를 저장하는 메인 테이블입니다.

| 컬럼명 | 타입 | 기본값 | 설명 |
|--------|------|--------|------|
| `id` | SERIAL | 자동 증가 | 기본키 |
| `자산번호` | TEXT | - | 사내 자산관리 번호 |
| `지급일` | TEXT | - | 자산 지급 날짜 |
| `반납일` | TEXT | - | 자산 반납 날짜 |
| `부서명` | TEXT | - | 사용자 소속 부서 |
| `사번` | TEXT | - | 사용자 사번 |
| `이메일` | TEXT | - | 사용자 이메일 |
| `사용자명` | TEXT | - | 사용자 이름 |
| `상태` | TEXT | `'사용중'` | 자산 상태 (사용중, 반납, 폐기 등) |
| `기기종류` | TEXT | `'노트북'` | 기기 종류 (노트북, 데스크탑 등) |
| `제조사` | TEXT | - | PC 제조사 (LENOVO, HP, DELL 등) |
| `모델명` | TEXT | - | PC 모델명 |
| `시리얼번호` | TEXT | - | 시리얼 번호 (S/N) — 엑셀 업로드 시 중복 체크 기준 |
| `사업장` | TEXT | - | 소속 사업장 (GS에너지, GS파워, 인천종합에너지) |
| `도입일` | TEXT | - | 기기 도입 날짜 — 교체 검토 기준 연수 계산에 사용 |
| `비고` | TEXT | - | 기타 메모 |
| `출처시트` | TEXT | - | 데이터 출처 (수동등록, 웹업로드, 웹업로드(덮어쓰기)) |
| `생성일` | TEXT | - | 레코드 생성 일시 (YYYY-MM-DD HH:MM:SS) |
| `수정일` | TEXT | - | 레코드 마지막 수정 일시 |

### users 테이블

사용자 인증 정보를 저장하는 테이블입니다.

| 컬럼명 | 타입 | 기본값 | 설명 |
|--------|------|--------|------|
| `id` | SERIAL | 자동 증가 | 기본키 |
| `username` | TEXT (UNIQUE, NOT NULL) | - | 로그인 아이디 |
| `password` | TEXT (NOT NULL) | - | 비밀번호 해시 (werkzeug generate_password_hash) |
| `role` | TEXT (NOT NULL) | `'user'` | 권한 (`admin` 또는 `user`) |
| `name` | TEXT | - | 표시 이름 |

### settings 테이블

시스템 설정을 key-value 형태로 저장하는 테이블입니다.

| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| `key` | TEXT (PK) | 설정 키 |
| `value` | TEXT | 설정 값 |

현재 사용 중인 설정:

| 키 | 기본값 | 설명 |
|----|--------|------|
| `replace_years` | `5` | 교체 검토 기준 연수. 도입일로부터 이 연수 이상 경과한 자산을 교체 대상으로 분류 |

---

## 배포 (Vercel)

이 프로젝트는 Vercel Serverless Functions를 사용하여 배포됩니다.

### 1. Vercel CLI 설치

```bash
npm install -g vercel
```

### 2. 프로젝트 연결 및 배포

```bash
vercel            # 최초 연결 및 프리뷰 배포
vercel --prod     # 프로덕션 배포
```

### 3. 환경변수 설정

Vercel 대시보드 또는 CLI를 통해 환경변수를 설정해야 합니다:

```bash
vercel env add SECRET_KEY
vercel env add DATABASE_URL
```

또는 Vercel 대시보드에서 `Settings > Environment Variables`에 아래 값을 추가합니다:

| 변수명 | 설명 |
|--------|------|
| `SECRET_KEY` | Flask 세션 암호화 키 |
| `DATABASE_URL` | PostgreSQL 연결 문자열 |

### vercel.json 설정

```json
{
  "builds": [
    { "src": "app.py", "use": "@vercel/python" }
  ],
  "routes": [
    { "src": "/static/(.*)", "dest": "/static/$1" },
    { "src": "/api/(.*)",    "dest": "/app.py" },
    { "src": "/(.*)",        "dest": "/app.py" }
  ]
}
```

- `@vercel/python` 빌더가 `app.py`를 서버리스 함수로 실행합니다.
- 정적 파일(`/static/`)은 직접 서빙하고, 나머지 모든 요청은 `app.py`로 라우팅됩니다.
- `.vercelignore` 파일을 통해 `vendor/`, `.venv/`, `.env`, DB 파일 등이 배포에서 제외됩니다.

---

## 주요 기능

- **대시보드** — 전체 자산 현황 KPI, 사업장별/상태별/기기종류별/제조사별/연식별 통계, 교체 검토 기준 설정
- **자산 목록** — 통합 검색, 다중 필터, 컬럼 정렬, 인라인 편집, 상세 보기
- **자산 등록** — 필수 항목 유효성 검사, 시리얼 번호(S/N) 중복 방지
- **엑셀 업로드** — `.xlsx` 파일 일괄 등록, 중복 S/N 발견 시 덮어쓰기 옵션 제공
- **로그인 / 권한 관리** — 관리자(`admin`)와 일반(`user`) 역할 구분, 세션 기반 인증

---

## 개발자

**김한희** -- GS에너지 52G
