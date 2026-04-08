import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'vendor'))
from flask import Flask, jsonify, request, render_template, session
import sqlite3
import hashlib
from datetime import datetime, date
from functools import wraps

# ── .env 파일 로드 (python-dotenv 없이 직접 파싱) ──────────
_env_path = os.path.join(os.path.dirname(__file__), '.env')
if os.path.exists(_env_path):
    with open(_env_path, encoding='utf-8') as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith('#') and '=' in _line:
                _k, _v = _line.split('=', 1)
                os.environ.setdefault(_k.strip(), _v.strip())

app = Flask(__name__)
# 세션 암호화 키 — .env 파일의 SECRET_KEY 값을 사용
# .env가 없으면 개발용 폴백 키 사용 (운영 환경에서는 반드시 .env 설정 필요)
_secret = os.environ.get('SECRET_KEY', '')
if not _secret:
    raise RuntimeError('.env 파일에 SECRET_KEY가 설정되지 않았습니다.')
app.secret_key = _secret
DB_PATH = os.path.join(os.path.dirname(__file__), 'assets.db')


# ─── DB 연결 ────────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def hash_pw(pw: str) -> str:
    return hashlib.sha256(pw.encode('utf-8')).hexdigest()


def init_db():
    conn = get_db()
    conn.execute('''
        CREATE TABLE IF NOT EXISTS assets (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            자산번호      TEXT,
            지급일        TEXT,
            반납일        TEXT,
            부서명        TEXT,
            사번          TEXT,
            이메일        TEXT,
            사용자명      TEXT,
            상태          TEXT DEFAULT '사용중',
            기기종류      TEXT DEFAULT '노트북',
            제조사        TEXT,
            모델명        TEXT,
            시리얼번호    TEXT,
            사업장        TEXT,
            도입일        TEXT,
            비고          TEXT,
            출처시트      TEXT,
            생성일        TEXT,
            수정일        TEXT
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY, value TEXT
        )
    ''')
    conn.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('replace_years', '5')")

    # ── 사용자 테이블 ──────────────────────────────────
    # TODO: 사내 SSO 연동 필요
    # 현재는 로컬 DB 계정만 지원합니다.
    # 추후 이 테이블 대신 회사 AD/SSO(SAML, OAuth2, LDAP 등)와
    # 연동하여 사번/패스워드 인증을 위임하세요.
    # 참고 라이브러리: python-saml, flask-oidc, ldap3
    conn.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role     TEXT NOT NULL DEFAULT 'user',
            name     TEXT
        )
    ''')
    # 기본 계정 — 최초 실행 시 1회만 생성 (이미 있으면 건너뜀)
    conn.execute("INSERT OR IGNORE INTO users (username, password, role, name) VALUES (?, ?, ?, ?)",
                 ('admin', hash_pw('admin1234'), 'admin', '시스템 관리자'))
    conn.execute("INSERT OR IGNORE INTO users (username, password, role, name) VALUES (?, ?, ?, ?)",
                 ('user', hash_pw('user1234'), 'user', '일반 사용자'))

    conn.commit()
    conn.close()


# ─── 인증 헬퍼 ──────────────────────────────────────────
def current_user():
    """세션에서 현재 로그인 사용자 정보 반환. 없으면 None."""
    return session.get('user')  # {'username': ..., 'role': ..., 'name': ...}


def login_required(f):
    """로그인하지 않은 요청을 401로 차단하는 데코레이터."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if not current_user():
            return jsonify({'error': 'unauthorized', 'message': '로그인이 필요합니다.'}), 401
        return f(*args, **kwargs)
    return decorated


def admin_required(f):
    """관리자 권한이 없으면 403으로 차단하는 데코레이터."""
    @wraps(f)
    def decorated(*args, **kwargs):
        u = current_user()
        if not u:
            return jsonify({'error': 'unauthorized', 'message': '로그인이 필요합니다.'}), 401
        if u.get('role') != 'admin':
            return jsonify({'error': 'forbidden', 'message': '관리자 권한이 필요합니다.'}), 403
        return f(*args, **kwargs)
    return decorated


# ─── 인증 API ────────────────────────────────────────────
@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.json or {}
    username = (data.get('username') or '').strip()
    password = (data.get('password') or '').strip()
    if not username or not password:
        return jsonify({'success': False, 'message': '아이디와 비밀번호를 입력하세요.'}), 400

    conn = get_db()
    row = conn.execute(
        'SELECT * FROM users WHERE username = ? AND password = ?',
        (username, hash_pw(password))
    ).fetchone()
    conn.close()

    if not row:
        return jsonify({'success': False, 'message': '아이디 또는 비밀번호가 올바르지 않습니다.'}), 401

    session['user'] = {'username': row['username'], 'role': row['role'], 'name': row['name']}
    session.permanent = False
    return jsonify({'success': True, 'role': row['role'], 'name': row['name']})


@app.route('/api/auth/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'success': True})


@app.route('/api/auth/me', methods=['GET'])
def me():
    u = current_user()
    if not u:
        return jsonify({'loggedIn': False}), 200
    return jsonify({'loggedIn': True, 'username': u['username'], 'role': u['role'], 'name': u['name']})


# ─── 설정 ────────────────────────────────────────────────
@app.route('/api/settings', methods=['GET'])
@login_required
def get_settings():
    conn = get_db()
    rows = conn.execute('SELECT key, value FROM settings').fetchall()
    conn.close()
    return jsonify({r['key']: r['value'] for r in rows})


@app.route('/api/settings', methods=['PUT'])
@admin_required
def update_settings():
    data = request.json
    conn = get_db()
    for key, value in data.items():
        conn.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', (key, value))
    conn.commit()
    conn.close()
    return jsonify({'success': True})


# ─── 자산 목록 ───────────────────────────────────────────
@app.route('/api/assets', methods=['GET'])
@login_required
def get_assets():
    conn = get_db()
    query = 'SELECT * FROM assets WHERE 1=1'
    params = []

    search    = request.args.get('search', '')
    site      = request.args.get('사업장', '')
    status    = request.args.get('상태', '')
    old_years = request.args.get('old_years', '')
    maker     = request.args.get('제조사', '')
    device    = request.args.get('기기종류', '')
    dept      = request.args.get('부서명', '')

    if search:
        query += ' AND (사용자명 LIKE ? OR 부서명 LIKE ? OR 모델명 LIKE ? OR 시리얼번호 LIKE ? OR 사번 LIKE ? OR 이메일 LIKE ? OR 자산번호 LIKE ?)'
        params.extend([f'%{search}%'] * 7)
    if site:
        query += ' AND 사업장 = ?'
        params.append(site)
    if status:
        query += ' AND 상태 = ?'
        params.append(status)
    if maker:
        query += ' AND 제조사 = ?'
        params.append(maker)
    if device:
        query += ' AND 기기종류 = ?'
        params.append(device)
    if dept:
        query += ' AND 부서명 = ?'
        params.append(dept)
    if old_years:
        cutoff = date(date.today().year - int(old_years), date.today().month, date.today().day).isoformat()
        query += " AND 도입일 IS NOT NULL AND 도입일 != '' AND 도입일 <= ?"
        params.append(cutoff)

    query += ' ORDER BY id DESC'
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route('/api/assets', methods=['POST'])
@admin_required
def create_asset():
    data = request.json
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    conn = get_db()
    conn.execute('''
        INSERT INTO assets
            (자산번호, 지급일, 반납일, 부서명, 사번, 이메일, 사용자명, 상태, 기기종류,
             제조사, 모델명, 시리얼번호, 사업장, 도입일, 비고, 출처시트, 생성일, 수정일)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        data.get('자산번호'), data.get('지급일'), data.get('반납일'),
        data.get('부서명'), data.get('사번'), data.get('이메일'), data.get('사용자명'),
        data.get('상태', '사용중'), data.get('기기종류', '노트북'),
        data.get('제조사'), data.get('모델명'), data.get('시리얼번호'),
        data.get('사업장'), data.get('도입일'), data.get('비고'), '수동등록', now, now
    ))
    conn.commit()
    conn.close()
    return jsonify({'success': True})


@app.route('/api/assets/<int:asset_id>', methods=['GET'])
@login_required
def get_asset(asset_id):
    conn = get_db()
    row = conn.execute('SELECT * FROM assets WHERE id = ?', (asset_id,)).fetchone()
    conn.close()
    return jsonify(dict(row)) if row else (jsonify({'error': '없음'}), 404)


@app.route('/api/assets/<int:asset_id>', methods=['PUT'])
@admin_required
def update_asset(asset_id):
    data = request.json
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    conn = get_db()
    conn.execute('''
        UPDATE assets SET
            자산번호=?, 지급일=?, 반납일=?, 부서명=?, 사번=?, 이메일=?, 사용자명=?,
            상태=?, 기기종류=?, 제조사=?, 모델명=?, 시리얼번호=?, 사업장=?, 도입일=?, 비고=?, 수정일=?
        WHERE id = ?
    ''', (
        data.get('자산번호'), data.get('지급일'), data.get('반납일'),
        data.get('부서명'), data.get('사번'), data.get('이메일'), data.get('사용자명'),
        data.get('상태'), data.get('기기종류'), data.get('제조사'),
        data.get('모델명'), data.get('시리얼번호'), data.get('사업장'),
        data.get('도입일'), data.get('비고'), now, asset_id
    ))
    conn.commit()
    conn.close()
    return jsonify({'success': True})


@app.route('/api/assets/bulk', methods=['POST'])
@admin_required
def bulk_import():
    """엑셀 업로드: S/N 기준 중복 체크, 트랜잭션으로 전체 롤백 보장
       overwrite=True 시 기존 레코드를 최신 데이터로 UPDATE
    """
    payload = request.json
    try:
        if isinstance(payload, list):
            data, overwrite = payload, False
        elif isinstance(payload, dict):
            data = payload.get('assets', [])
            overwrite = bool(payload.get('overwrite', False))
        else:
            return jsonify({'success': False, 'error': '잘못된 데이터 형식입니다.'}), 400
    except Exception:
        return jsonify({'success': False, 'error': '잘못된 데이터 형식입니다.'}), 400

    conn = get_db()
    try:
        existing = {
            r[0]: r[1] for r in
            conn.execute('SELECT 시리얼번호, id FROM assets WHERE 시리얼번호 IS NOT NULL').fetchall()
        }
        now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        inserted, skipped, updated = 0, 0, 0

        for asset in data:
            sn = asset.get('시리얼번호')
            if not sn:
                continue
            if sn in existing:
                if overwrite:
                    conn.execute('''
                        UPDATE assets SET
                            자산번호=?, 지급일=?, 반납일=?, 부서명=?, 사번=?, 이메일=?,
                            사용자명=?, 상태=?, 기기종류=?, 제조사=?, 모델명=?,
                            사업장=?, 도입일=?, 비고=?, 출처시트=?, 수정일=?
                        WHERE 시리얼번호=?
                    ''', (
                        asset.get('자산번호'), asset.get('지급일'), asset.get('반납일'),
                        asset.get('부서명'), asset.get('사번'), asset.get('이메일'),
                        asset.get('사용자명'), asset.get('상태', '사용중'),
                        asset.get('기기종류', '노트북'), asset.get('제조사'),
                        asset.get('모델명'), asset.get('사업장'), asset.get('도입일'),
                        asset.get('비고'), '웹업로드(덮어쓰기)', now, sn
                    ))
                    updated += 1
                else:
                    skipped += 1
                continue

            conn.execute('''
                INSERT INTO assets
                    (자산번호, 지급일, 반납일, 부서명, 사번, 이메일, 사용자명, 상태, 기기종류,
                     제조사, 모델명, 시리얼번호, 사업장, 도입일, 비고, 출처시트, 생성일, 수정일)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ''', (
                asset.get('자산번호'), asset.get('지급일'), asset.get('반납일'),
                asset.get('부서명'), asset.get('사번'), asset.get('이메일'), asset.get('사용자명'),
                asset.get('상태', '사용중'), asset.get('기기종류', '노트북'),
                asset.get('제조사'), asset.get('모델명'), sn,
                asset.get('사업장'), asset.get('도입일'), asset.get('비고'), '웹업로드', now, now
            ))
            existing[sn] = None
            inserted += 1

        conn.commit()
        return jsonify({'success': True, 'inserted': inserted, 'skipped': skipped,
                        'updated': updated, 'total': inserted + skipped + updated})
    except Exception as e:
        conn.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        conn.close()


@app.route('/api/assets/<int:asset_id>', methods=['DELETE'])
@admin_required
def delete_asset(asset_id):
    conn = get_db()
    conn.execute('DELETE FROM assets WHERE id = ?', (asset_id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True})


# ─── 필터 메타 ───────────────────────────────────────────
@app.route('/api/filters/departments')
@login_required
def filter_departments():
    conn = get_db()
    rows = conn.execute(
        "SELECT DISTINCT 부서명 FROM assets WHERE 부서명 IS NOT NULL AND 부서명 != '' ORDER BY 부서명"
    ).fetchall()
    conn.close()
    return jsonify([r[0] for r in rows])


# ─── 대시보드 ─────────────────────────────────────────────
@app.route('/api/dashboard')
@login_required
def dashboard():
    conn = get_db()
    replace_years = int(conn.execute(
        "SELECT value FROM settings WHERE key='replace_years'"
    ).fetchone()['value'])
    cutoff = date(date.today().year - replace_years, date.today().month, date.today().day).isoformat()

    total     = conn.execute('SELECT COUNT(*) FROM assets').fetchone()[0]
    by_site   = conn.execute('SELECT 사업장, COUNT(*) as 수량 FROM assets GROUP BY 사업장 ORDER BY 수량 DESC').fetchall()
    by_status = conn.execute('SELECT 상태, COUNT(*) as 수량 FROM assets GROUP BY 상태 ORDER BY 수량 DESC').fetchall()
    by_maker  = conn.execute('SELECT COALESCE(NULLIF(제조사,\'\'), \'기타\') as 제조사, COUNT(*) as 수량 FROM assets GROUP BY 1 ORDER BY 수량 DESC').fetchall()
    old_count = conn.execute(
        "SELECT COUNT(*) FROM assets WHERE 도입일 IS NOT NULL AND 도입일 != '' AND 도입일 <= ?",
        (cutoff,)
    ).fetchone()[0]
    conn.close()

    return jsonify({
        'total': total,
        'by_site': [dict(r) for r in by_site],
        'by_status': [dict(r) for r in by_status],
        'by_maker': [dict(r) for r in by_maker],
        'old_count': old_count,
        'replace_years': replace_years,
    })


@app.route('/')
def index():
    return render_template('index.html')


if __name__ == '__main__':
    init_db()
    print('=' * 50)
    print('  PC 자산관리 시스템 시작')
    print('  http://localhost:5000')
    print('=' * 50)
    app.run(debug=False, port=5000)
