import sys, os, traceback
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'vendor'))
from flask import Flask, jsonify, request, render_template, session
import psycopg
from psycopg.rows import dict_row
from datetime import datetime, date, timedelta
from functools import wraps
from werkzeug.security import generate_password_hash, check_password_hash

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
DATABASE_URL = os.environ.get('DATABASE_URL', '')
if not DATABASE_URL:
    raise RuntimeError('.env 파일에 DATABASE_URL이 설정되지 않았습니다.')


# ─── DB 연결 ────────────────────────────────────────────
def get_db():
    conn = psycopg.connect(DATABASE_URL, autocommit=False, row_factory=dict_row)
    return conn


def fetchone(conn, query, params=()):
    return conn.execute(query, params).fetchone()


def fetchall(conn, query, params=()):
    return conn.execute(query, params).fetchall()


def execute(conn, query, params=()):
    conn.execute(query, params)


def hash_pw(pw: str) -> str:
    return generate_password_hash(pw)


def date_years_ago(years):
    """N년 전 날짜를 안전하게 계산 (윤년 2/29 → 2/28 보정)"""
    today = date.today()
    try:
        return date(today.year - years, today.month, today.day)
    except ValueError:
        return date(today.year - years, today.month, today.day - 1)


def init_db():
    conn = get_db()
    execute(conn, '''
        CREATE TABLE IF NOT EXISTS assets (
            id            SERIAL PRIMARY KEY,
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
    execute(conn, '''
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY, value TEXT
        )
    ''')
    execute(conn, "INSERT INTO settings (key, value) VALUES ('replace_years', '5') ON CONFLICT (key) DO NOTHING")

    # ── 사용자 테이블 ──────────────────────────────────
    # TODO: 사내 SSO 연동 필요
    execute(conn, '''
        CREATE TABLE IF NOT EXISTS users (
            id       SERIAL PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role     TEXT NOT NULL DEFAULT 'user',
            name     TEXT
        )
    ''')
    # 기본 계정 — 최초 실행 시 1회만 생성 (이미 있으면 건너뜀)
    execute(conn, "INSERT INTO users (username, password, role, name) VALUES (%s, %s, %s, %s) ON CONFLICT (username) DO NOTHING",
            ('admin', hash_pw('admin1234'), 'admin', '시스템 관리자'))
    execute(conn, "INSERT INTO users (username, password, role, name) VALUES (%s, %s, %s, %s) ON CONFLICT (username) DO NOTHING",
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

    try:
        conn = get_db()
        row = fetchone(conn, 'SELECT id, username, password, role, name FROM users WHERE username = %s', (username,))
        conn.close()
    except Exception:
        traceback.print_exc()
        return jsonify({'success': False, 'message': '서버 오류가 발생했습니다.'}), 500

    if not row or not check_password_hash(row['password'], password):
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
    try:
        rows = fetchall(conn, 'SELECT key, value FROM settings')
        return jsonify({r['key']: r['value'] for r in rows})
    finally:
        conn.close()


ALLOWED_SETTINGS = {'replace_years'}

@app.route('/api/settings', methods=['PUT'])
@admin_required
def update_settings():
    data = request.json
    conn = get_db()
    try:
        for key, value in data.items():
            if key not in ALLOWED_SETTINGS:
                continue
            execute(conn, 'INSERT INTO settings (key, value) VALUES (%s, %s) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', (key, value))
        conn.commit()
        return jsonify({'success': True})
    except Exception:
        conn.rollback()
        traceback.print_exc()
        return jsonify({'success': False, 'message': '설정 저장 실패'}), 500
    finally:
        conn.close()


ASSET_COLS = 'id, 자산번호, 지급일, 반납일, 부서명, 사번, 이메일, 사용자명, 상태, 기기종류, 제조사, 모델명, 시리얼번호, 사업장, 도입일, 비고, 출처시트, 생성일, 수정일'

# ─── 자산 목록 ───────────────────────────────────────────
@app.route('/api/assets', methods=['GET'])
@login_required
def get_assets():
    conn = get_db()
    try:
        query = f'SELECT {ASSET_COLS} FROM assets WHERE 1=1'
        params = []

        search    = request.args.get('search', '')
        site      = request.args.get('사업장', '')
        status    = request.args.get('상태', '')
        old_years = request.args.get('old_years', '')
        maker     = request.args.get('제조사', '')
        device    = request.args.get('기기종류', '')
        dept      = request.args.get('부서명', '')

        if search:
            query += ' AND (사용자명 ILIKE %s OR 부서명 ILIKE %s OR 모델명 ILIKE %s OR 시리얼번호 ILIKE %s OR 사번 ILIKE %s OR 이메일 ILIKE %s OR 자산번호 ILIKE %s)'
            params.extend([f'%{search}%'] * 7)
        if site:
            query += ' AND 사업장 = %s'
            params.append(site)
        if status:
            query += ' AND 상태 = %s'
            params.append(status)
        if maker:
            query += ' AND 제조사 = %s'
            params.append(maker)
        if device:
            query += ' AND 기기종류 = %s'
            params.append(device)
        if dept:
            query += ' AND 부서명 = %s'
            params.append(dept)
        age_range = request.args.get('age_range', '')
        if old_years:
            cutoff = date_years_ago(int(old_years)).isoformat()
            query += " AND 도입일 IS NOT NULL AND 도입일 != '' AND 도입일 <= %s"
            params.append(cutoff)
        elif age_range:
            if age_range == 'lt1':
                query += " AND 도입일 IS NOT NULL AND 도입일 != '' AND 도입일 > %s"
                params.append(date_years_ago(1).isoformat())
            elif age_range == '1to2':
                query += " AND 도입일 IS NOT NULL AND 도입일 != '' AND 도입일 > %s AND 도입일 <= %s"
                params.extend([date_years_ago(2).isoformat(), date_years_ago(1).isoformat()])
            elif age_range == '2to3':
                query += " AND 도입일 IS NOT NULL AND 도입일 != '' AND 도입일 > %s AND 도입일 <= %s"
                params.extend([date_years_ago(3).isoformat(), date_years_ago(2).isoformat()])
            elif age_range == '3to5':
                query += " AND 도입일 IS NOT NULL AND 도입일 != '' AND 도입일 > %s AND 도입일 <= %s"
                params.extend([date_years_ago(5).isoformat(), date_years_ago(3).isoformat()])
            elif age_range == 'gt5':
                query += " AND 도입일 IS NOT NULL AND 도입일 != '' AND 도입일 <= %s"
                params.append(date_years_ago(5).isoformat())

        query += ' ORDER BY id DESC'
        rows = fetchall(conn, query, params)
        return jsonify(rows)
    finally:
        conn.close()


@app.route('/api/assets', methods=['POST'])
@admin_required
def create_asset():
    data = request.json
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    conn = get_db()
    try:
        execute(conn, '''
            INSERT INTO assets
                (자산번호, 지급일, 반납일, 부서명, 사번, 이메일, 사용자명, 상태, 기기종류,
                 제조사, 모델명, 시리얼번호, 사업장, 도입일, 비고, 출처시트, 생성일, 수정일)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ''', (
            data.get('자산번호'), data.get('지급일'), data.get('반납일'),
            data.get('부서명'), data.get('사번'), data.get('이메일'), data.get('사용자명'),
            data.get('상태', '사용중'), data.get('기기종류', '노트북'),
            data.get('제조사'), data.get('모델명'), data.get('시리얼번호'),
            data.get('사업장'), data.get('도입일'), data.get('비고'), '수동등록', now, now
        ))
        conn.commit()
        return jsonify({'success': True})
    except Exception:
        conn.rollback()
        traceback.print_exc()
        return jsonify({'success': False, 'message': '자산 등록 실패'}), 500
    finally:
        conn.close()


@app.route('/api/assets/<int:asset_id>', methods=['GET'])
@login_required
def get_asset(asset_id):
    conn = get_db()
    try:
        row = fetchone(conn, f'SELECT {ASSET_COLS} FROM assets WHERE id = %s', (asset_id,))
        return jsonify(row) if row else (jsonify({'error': '없음'}), 404)
    finally:
        conn.close()


@app.route('/api/assets/<int:asset_id>', methods=['PUT'])
@admin_required
def update_asset(asset_id):
    data = request.json
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    conn = get_db()
    try:
        execute(conn, '''
            UPDATE assets SET
                자산번호=%s, 지급일=%s, 반납일=%s, 부서명=%s, 사번=%s, 이메일=%s, 사용자명=%s,
                상태=%s, 기기종류=%s, 제조사=%s, 모델명=%s, 시리얼번호=%s, 사업장=%s, 도입일=%s, 비고=%s, 수정일=%s
            WHERE id = %s
        ''', (
            data.get('자산번호'), data.get('지급일'), data.get('반납일'),
            data.get('부서명'), data.get('사번'), data.get('이메일'), data.get('사용자명'),
            data.get('상태'), data.get('기기종류'), data.get('제조사'),
            data.get('모델명'), data.get('시리얼번호'), data.get('사업장'),
            data.get('도입일'), data.get('비고'), now, asset_id
        ))
        conn.commit()
        return jsonify({'success': True})
    except Exception:
        conn.rollback()
        traceback.print_exc()
        return jsonify({'success': False, 'message': '자산 수정 실패'}), 500
    finally:
        conn.close()


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
        existing_rows = fetchall(conn, 'SELECT 시리얼번호, id FROM assets WHERE 시리얼번호 IS NOT NULL')
        existing = {r['시리얼번호']: r['id'] for r in existing_rows}
        now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        inserted, skipped, updated = 0, 0, 0

        for asset in data:
            sn = asset.get('시리얼번호')
            if not sn:
                continue
            if sn in existing:
                if overwrite:
                    execute(conn, '''
                        UPDATE assets SET
                            자산번호=%s, 지급일=%s, 반납일=%s, 부서명=%s, 사번=%s, 이메일=%s,
                            사용자명=%s, 상태=%s, 기기종류=%s, 제조사=%s, 모델명=%s,
                            사업장=%s, 도입일=%s, 비고=%s, 출처시트=%s, 수정일=%s
                        WHERE 시리얼번호=%s
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

            execute(conn, '''
                INSERT INTO assets
                    (자산번호, 지급일, 반납일, 부서명, 사번, 이메일, 사용자명, 상태, 기기종류,
                     제조사, 모델명, 시리얼번호, 사업장, 도입일, 비고, 출처시트, 생성일, 수정일)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
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
    except Exception:
        conn.rollback()
        traceback.print_exc()
        return jsonify({'success': False, 'error': '업로드 처리 중 오류가 발생했습니다.'}), 500
    finally:
        conn.close()


@app.route('/api/assets/<int:asset_id>', methods=['DELETE'])
@admin_required
def delete_asset(asset_id):
    conn = get_db()
    try:
        execute(conn, 'DELETE FROM assets WHERE id = %s', (asset_id,))
        conn.commit()
        return jsonify({'success': True})
    finally:
        conn.close()


# ─── 필터 메타 ───────────────────────────────────────────
@app.route('/api/filters/departments')
@login_required
def filter_departments():
    conn = get_db()
    try:
        rows = fetchall(conn, "SELECT DISTINCT 부서명 FROM assets WHERE 부서명 IS NOT NULL AND 부서명 != '' ORDER BY 부서명")
        return jsonify([r['부서명'] for r in rows])
    finally:
        conn.close()


@app.route('/api/filters/models')
@login_required
def filter_models():
    maker = request.args.get('제조사', '')
    conn = get_db()
    try:
        if maker:
            rows = fetchall(conn,
                "SELECT DISTINCT 모델명 FROM assets WHERE 제조사 = %s AND 모델명 IS NOT NULL AND 모델명 != '' ORDER BY 모델명",
                (maker,))
        else:
            rows = fetchall(conn,
                "SELECT DISTINCT 모델명 FROM assets WHERE 모델명 IS NOT NULL AND 모델명 != '' ORDER BY 모델명")
        return jsonify([r['모델명'] for r in rows])
    finally:
        conn.close()


# ─── 대시보드 ─────────────────────────────────────────────
@app.route('/api/dashboard')
@login_required
def dashboard():
    conn = get_db()
    try:
        row = fetchone(conn, "SELECT value FROM settings WHERE key='replace_years'")
        replace_years = int(row['value']) if row else 5
        ry = replace_years

        total     = fetchone(conn, 'SELECT COUNT(*) as cnt FROM assets')['cnt']
        by_site   = fetchall(conn, 'SELECT 사업장, COUNT(*) as 수량 FROM assets GROUP BY 사업장 ORDER BY 수량 DESC')
        by_status = fetchall(conn, 'SELECT 상태, COUNT(*) as 수량 FROM assets GROUP BY 상태 ORDER BY 수량 DESC')
        by_maker  = fetchall(conn, "SELECT COALESCE(NULLIF(제조사,''), '기타') as 제조사, COUNT(*) as 수량 FROM assets GROUP BY 1 ORDER BY 수량 DESC")
        by_type   = fetchall(conn, "SELECT COALESCE(NULLIF(기기종류,''), '기타') as 기기종류, COUNT(*) as 수량 FROM assets GROUP BY 1 ORDER BY 수량 DESC")

        y1 = date_years_ago(1).isoformat()
        y2 = date_years_ago(2).isoformat()
        y3 = date_years_ago(3).isoformat()
        yr = date_years_ago(ry).isoformat()

        by_age = fetchall(conn, """
            SELECT
              CASE
                WHEN 도입일 IS NULL OR 도입일 = '' THEN '도입일 없음'
                WHEN 도입일 > %s THEN '1년 미만'
                WHEN 도입일 > %s THEN '1년~2년'
                WHEN 도입일 > %s THEN '2년~3년'
                WHEN 도입일 > %s THEN %s
                ELSE %s
              END as 구간,
              COUNT(*) as 수량
            FROM assets
            GROUP BY 1
        """, (y1, y2, y3, yr,
              f'3년~{ry}년',
              f'{ry}년 이상'))

        label_mid = f'3년~{ry}년'
        label_old = f'{ry}년 이상'
        age_order = ['1년 미만', '1년~2년', '2년~3년', label_mid, label_old, '도입일 없음']
        age_map = {r['구간']: r['수량'] for r in by_age}
        by_age_sorted = [{'구간': k, '수량': age_map.get(k, 0)} for k in age_order if age_map.get(k, 0) > 0]
        old_count = age_map.get(label_old, 0)

        return jsonify({
            'total': total,
            'by_site': by_site,
            'by_status': by_status,
            'by_maker': by_maker,
            'by_type':  by_type,
            'by_age': by_age_sorted,
            'old_count': old_count,
            'replace_years': replace_years,
        })
    finally:
        conn.close()


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
