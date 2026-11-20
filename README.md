# NestWay Slider — 은퇴 금융자산 최적화 워크벤치 (`nestway_slider`)

**NestWay Slider**는 대한민국의 세법(종합소득세, 금융소득종합과세 및 배당 Gross-Up·배당세액공제, 법정 퇴직소득세·연금수령 3단계 감면, 해외주식 양도소득세, 2026 개정 법인세·성실신고확인대상 판정, 주택 재산세·종부세, 상증세법 제45조의5·제22조·제26조 상속세 진단), 국민건강보험(재산 기본공제 1억 및 시행령 별표4 60등급표, 금융소득 1,000만 원 절벽, 인별 피부양자 3단계 요건 및 지역건보 상한), 국민연금(출생연도별 수급개시연령, `2026~2033` 보험료율 단계적 인상, `2026.06.17` 소득활동 감액 개편안)을 통합 반영하여 **은퇴 가계 자산의 개인·법인 최적 배분(`r*`) 및 강건 실행 권고, 절세 인출 워터폴, 법인 4대 출구전략, 4-Part 마스터플랜 PDF 리포트**를 산출하는 의사결정 워크벤치입니다.

---

## ✨ 핵심 설계 및 최신 정합성 사양 (`v1.2.26`)

### 1. 단일 정규 5대 계좌 원장 커널 (`Single Canonical 5-Basket Ledger Engine`)
- **단일 상태머신 (`src/engine/ledgerKernel.ts` — `runCanonicalLedger`)**:
  - 개인 100%(`personalRatio = 100`), 법인 100%(`personalRatio = 0`), 하이브리드(`0 < personalRatio < 100`) 전략을 별도 분기 없이 동일한 원장 커널에서 계산하여 전략 간 회계 비대칭(Cross-Engine Drift)을 방지합니다.
  - **5대 계좌 바스켓**: ① `퇴직연금 IRP` · ② `중개형 ISA` · ③ `개인연금저축` · ④ `개인 일반과세계좌(해외직투/국내상장 ETF)` · ⑤ `가족법인(납입자본금·가수금·이익잉여금)`
- **1원 단위 회계 보존 항등식 (`accountingResidual === 0`)**:
  - 모든 시뮬레이션 연도 `t` (기본 50세~100세, 51개년)에서 아래 항등식을 1원 오차 없이 검증합니다 (**`11,216`개 시나리오-연차 전수 통과**):
    $$\text{endBookTotal}_t - \left(\text{startBookTotal}_t + \text{totalGrossReturn}_t + \text{totalExternalInflow}_t - \text{livingExpenseOutflow}_t - \text{totalTaxAndHealthLoad}_t\right) \equiv 0$$
- **장부잔액(`endBookTotal`) vs 세후 가처분 순자산(`endDisposableNetWorth`) 대칭 청산·상속 평가**:
  - 가족법인 청산 부담(`resolveCorporateExitBreakdown`: 미실현 잠재 법인세 정산 ➔ 출자원금·가수금 비과세 회수 ➔ 잔여 이익잉여금 의제배당 인별 종합과세·Gross-Up 및 지역건보 상한 반영)과 개인 계좌 잠재 청산세(`resolvePersonalExitNetWorth`: 미실현 해외주식 22%·국내상장 과세형 ETF 15.4%·ISA 9.9%·연금저축/IRP 분할 인출세)를 대칭 차감하며, 100세 시점 **청산 vs 상속세(`estateDiagnostic`, 금융재산상속공제 최대 2억 반영)** 비교 진단을 함께 제공합니다.

### 2. 절세 인출 워터폴(`1-A`) & 2026 세법·건보 정밀 반영
1. **Stage 1 (기초 현금흐름)**: 국민연금(출생연도별 수급연령, `2026.06.17` `A값+200만` 근로소득 감액 완화 및 재직 중 조기연금 정지 반영) + 주택연금 + 일반계좌 세후 배당금 우선 충당
2. **Stage 2 (가족법인 임원 급여)**: 급여 역산 솔버(`solveHouseholdExecutivePayroll`)로 인별 만 60세 미만 국민연금(`2026년 9.5% ➔ 매년 +0.5%p ➔ 2033년 13.0%` 상한)과 직장건보료를 반영해 목표 실수령액을 지급하고 지역건보료를 방어(배우자 피부양자 인별 판정 연동)
3. **Stage 3 & 4 (55세 이후 사적연금 선인출 & ISA 비과세 복리 보존)**:
   - **55세 미만 은퇴 브릿지 구간**: 중개형 ISA 우선 인출(생애 누적 비과세 한도 추적 후 초과 수익 `9.9%` 분리과세)
   - **55세 이후 연금 개시 구간**:
     - **연금저축**: 비세액공제 원금(연 600만 원 초과 납입분) `0%` 비과세 선인출 후 인당 연 `1,500만 원`(부부 최대 `3,000만 원`) 한도 내 연령별 `3.3% ~ 5.5%` 저율 분리과세
     - **퇴직연금 IRP**: 본인·배우자 저율 한도 인별 적용 + 이연퇴직소득 원금 10년 연금수령한도(`소득세법 시행령 §40의2`) 페이싱 + 연차별 3단계 퇴직소득세 감면(`1~10년차 30%`, `11~20년차 40%`, `21년차+ 50%` 감면, `소득세법 §129①5의3`) 선인출 후 부족분만 ISA에서 인출
4. **Stage 5 (가족법인 출자원금·가수금 무세금 회수)**: 납입자본금(설립 등록면허세 `0.48%` 반영) 또는 주주대여금 가수금을 세금·건보료 `0원`으로 회수(법인 자산 매도 시 실현차익 법인세 `11%/22%` 및 15년 이월결손금 80% 공제 한도 반영)
5. **Stage 6 & 7 (개인 일반과세계좌 매도)**: 부부 지분율(`selfOwnershipPercent`) 기준 인당 `250만 원` 기본공제 후 해외직투 `22%` 양도소득세 분리과세 + 하락장 언더워터(`taxable < taxableBasis`) 취득원가 보존 + 국내 주식형 지수 ETF(`KR_INDEX`) 매매차익 비과세 및 국내상장 기타 ETF `15.4%` 배당소득세·종소세·건보 연동
6. **Stage 8 (비상 초과 인출)**: 잔여 부족분 발생 시 사적연금 한도초과 인출(`Min(16.5% 분리과세, 종합소득 합산과세)`) 또는 법인 초과배당(`소득세법 §17③·§56` 배당 Gross-Up[2026년 `10%`, 2027년+ `11%`] 및 배당세액공제, `15.4%` 원천징수 비교과세 하한 `§62`, 익년도 지역건보 소득 이월)

### 3. 주요 엔지니어링 기능 (`v1.2.15` ~ `v1.2.26`)
- **수학적 최적해(`r*`)와 강건 실행 권고(`recommendAllocation`) 이원화**:
  - 유지비 `×1.5` 및 기대수익률 `−0.5%p` 불리한 섭동에서도 개인 단독 운용 대비 실익이 유지되고 월 지속가능 생활비가 열위가 아닐 때만 법인 혼합을 최종 실행 권고로 채택하며, 권고 사유와 손익분기 진단을 투명하게 공개합니다.
- **성실신고확인대상 소규모법인(`22%`) 연도별 판정 및 가이드 (`sincereFiling.ts`, `SincereFilingGuide.tsx`)**:
  - 법인 수령 배당 비중(`(배당+이자) ÷ 매출 ≥ 50%`)을 연차별로 판정하여 일반 법인세율(`11%/22%`) 대비 성실신고확인대상(`22%` 단일세율) 해당 가능 연수와 회피에 필요한 추가 매매차익 규모, 업종 요건·실질과세 유의사항을 안내합니다.
- **연도별 순서위험 몬테카를로(`100`표본) & `Plan B` 단일 레버 정량 해소치 (`sensitivityBand.ts`, `planVerdict.ts`)**:
  - 시드 고정(`mulberry32`) 연도별 i.i.d. 정규 수익률 경로(`σ = 12%p`, 대칭변량 100표본)로 100세 자산 생존확률(`안전 ≥ 80%` · `주의 60~79%` · `위험 < 60%`)과 `±2.0%p` 민감도 밴드를 산출합니다.
  - 주의·위험 판정 시 결정론 원장 역산으로 **① 은퇴 후 월 생활비 `−X` · ② 은퇴 시점 `+N년` · ③ 은퇴 전 월 저축 `+Z`** 중 하나만 조정해도 안전마진(100세 무고갈 + 월 여유 100만 원 이상)을 회복하는 최소 수치를 제시합니다.
- **이원화(Dual-Scope) ETF 포트폴리오 빌더 & 6대 대표 시나리오 프리셋**:
  - 일반·법인 계좌(한·미 4종 프리셋)와 절세·연금 계좌(KRX 전용 5종 프리셋 및 **IRP 위험자산 70% 한도** 자동 반영)를 분리 지원하며, 파이어족 싱글부터 **법인 50% 균형(`hybrid-50-55-corp50`)**·**법인 100% 집중(`corp-100-focus`)**까지 6대 대표 가구 프리셋을 제공합니다.
- **무상태 로컬 JSON 입출력(`scenarioIo.ts`) & 모바일(`≤640px`) 적응형 UI**:
  - 서버에 개인 재무 데이터를 일절 전송·저장하지 않으며, 상단 `📥 내보내기` / `📤 불러오기`로 로컬 `.json` 파일 백업·복원(1MB 상한, 키 화이트리스트·유한수 정화)을 지원합니다.
  - 모바일(`≤640px`)에서는 1열 카드 레이아웃, 브리핑 6탭 한 줄 스크롤, 터치 화면 16px 숫자 키패드(`inputMode="decimal"`), `ⓘ` 도움말·원장 산출근거 바텀시트, 배분 곡선 터치 2-탭 적용(`resolveCurveTap`)으로 동작하며 데스크톱 및 A4 가로형 PDF 인쇄 레이아웃과 간섭하지 않습니다.

---

## 🖥️ 3단계 하이브리드 UI 아키텍처 & 4-Part 마스터플랜 PDF 리포트

1. **`① 조건 입력 (단계별 위저드)` (`src/components/InputWizard.tsx`, `WizardLiveChip.tsx`)**:
   - `1. 연령·은퇴시기` ➔ `2. 목표 은퇴생활비` ➔ `3. 일반금융자산(부부 지분율)` ➔ `4. 절세·연금계좌(본인·배우자 퇴직금 분리 과세)` ➔ `5. 은퇴전저축` ➔ `6. 일반·법인 수익률(±3%p 시나리오)` ➔ `7. 절세·연금 수익률` ➔ `8. 물가·시장환경` ➔ `9. 부동산(보유세)·국민연금` ➔ `10. 법인(설립시점·가수금/자본금·청산/상속)·배분전략`의 10단계 집중 카드, 실시간 하단 결과 칩(`WizardLiveChip`), `Step 11` 전체 입력 요약 화면을 제공합니다.
2. **`② 핵심 결과 브리핑 (단계별 슬라이드)` (`src/components/ActionGuideView.tsx`, `BriefingVisuals.tsx`, `InfoPop.tsx`)**:
   - 핵심 결론과 미니 차트를 먼저 보여주고 세부 산식은 `ⓘ` 팝오버(`InfoPop`)로 정돈한 6단계 브리핑 슬라이드(`결과 1. 종합 판정` ~ `결과 6. 실행 체크리스트 & 요약`)를 제공하며, 각 슬라이드에서 해당 심층 분석 타일로 원클릭 이동할 수 있습니다.
3. **`③ 상세 분석 & 원장` (`Lens1~3` + 4-Tile Bento Selector)**:
   - **`분석 01` (`Lens1AllocationTrack.tsx`)**: 개인 vs 법인 배분 곡선(`★ 수학적 최적 r*` · `✔ 실행 권고` 마커), 수익률 민감도 밴드 순자산 궤적 차트(범례 토글·Y축 자동 스케일링), 연간 절세·건보 방어 실익 차트.
   - **`분석 02` (`Lens2WaterfallLedger.tsx` 차트 모드)**: 5대 계좌 연차별 잔액 적층 차트 및 인출 원천 워터폴 차트.
   - **`분석 03` (`Lens3StrategyMatrix.tsx`)**: 3대 전략 비교 스코어보드, 법인 설립 손익분기 판정, 국민연금 수령 시기 비교(`정상수령 누적교차 X세`), 법인 임원 수·4대 출구전략·100세 청산 vs 상속세 진단, 시나리오 A/B 스냅샷 비교, 실행 체크리스트.
   - **`분석 04` (`Lens2WaterfallLedger.tsx` 원장 모드)**: 51개년 1원 정밀 현금흐름 원장 표(연차 첫 열 고정, `개인세·법인세·주택보유세` 분리 표기, 산출근거·절벽 여유 한도 팝오버 `.ledger-why-popover`) 및 **`[단일 원장 CSV]` / `[통합 마스터플랜 CSV]`** 내보내기.
4. **`🖨️ PDF 마스터플랜 리포트` (4-Part A4 Landscape 인쇄 레이아웃)**:
   - 상단 헤더의 `🖨️ PDF 마스터플랜 리포트` 클릭 시 전용 4-Part 리포트 레이아웃(`.print-masterplan-report`: `PART I` 10대 전제조건·브리핑 요약·Plan B 레버 ➔ `PART II` 배분 효율 & 궤적 ➔ `PART III` 계좌 적층·출구/상속·성실신고 가이드·체크리스트 ➔ `PART IV` 51개년 전체 원장 표·법정 산식 검증 부록·세무사법/자본시장법 비자문 고지 푸터)으로 전환되어 A4 가로형 PDF를 출력합니다.

---

## 🚀 빠른 시작 (Standalone GitHub Clone Quickstart)

외부 인프라나 별도 데이터베이스 서버 없이 **Node.js (v20+)** 와 **Python 3 (3.10+, 표준 라이브러리만 사용)** 만 있으면 어디서나 즉시 실행할 수 있습니다.

### 1. 저장소 클론 및 환경 설정
> **브랜치 안내 (`https://github.com/torch95/NestWay.git`)**:
> - **`main` (기본 브랜치)** 및 **`nestway-slider` (호환 브랜치)**: **NestWay Slider** 최신 코드가 기본 `main` 브랜치에 탑재되어 있습니다.

```bash
git clone https://github.com/torch95/NestWay.git nestway_slider
cd nestway_slider

# 선택적 포트 설정 생성 (기본 포트 8089)
cp .env.example .env

# 프론트엔드 의존성 설치
npm install
```

> **시나리오 저장·불러오기 안내**:
> - 모든 입력 데이터는 서버에 저장되지 않고 브라우저 `localStorage`에만 보관되며, 상단 헤더의 **`📥 내보내기`** / **`📤 불러오기`** 버튼으로 무제한 로컬 `.json` 시나리오 파일(기존 `user_state.json` 포함)을 백업·복원할 수 있습니다.

### 2. 실행 방법

#### 방법 A: 프론트엔드(Vite HMR) + 백엔드 API 동시 개발 모드
순수 시뮬레이션 엔진은 브라우저에서 100% 동작하며, 1,274종 ETF 검색 API(`/api/etf/list`)까지 함께 사용하려면 백엔드 서버(`:8089`)를 함께 띄웁니다.
```bash
# 터미널 1: Python 백엔드 기동 (기본 포트 8089)
npm start

# 터미널 2: Vite 개발 서버 기동 (`/api/*` 요청은 vite.config.ts 프록시로 :8089 백엔드에 전달)
npm run dev
```

#### 방법 B: 프로덕션 단일 서버 실행 (권장, `:8089` 단일 포트)
프론트엔드를 `dist/`로 빌드한 뒤 Python 표준 라이브러리 서버 하나로 정적 웹앱과 ETF SQLite API를 동시에 서빙합니다.
```bash
npm run build
npm start
# 브라우저에서 http://localhost:8089 접속
```

### 3. 전체 테스트 스위트 실행
원장 1원 보존 항등식(`ledgerInvariants`), 옵티마이저(`optimizer`), 세무·건보(`taxAndHealth`), 성실신고(`sincereFiling`), 연금·ETF(`pensionAndEtf`), 프리셋(`portfolioPresets`), 시나리오 입출력(`scenarioIo`), UI·문서 정합성(`uiParity`), TypeScript 타입체크(`tsc --noEmit`), Python 백엔드 무상태 보안·ETF API 단위 테스트(`tests/test_server.py`)를 한 번에 검증합니다.
```bash
npm test
```

---

## 📂 디렉토리 구조

```text
nestway_slider/
├── server.py                      # Python stdlib 무상태 HTTP 서버 (기본 127.0.0.1:8089, 🎚️ 파비콘 & 읽기전용 ETF SQLite API)
├── etf_universe.db                # (선택) 로컬 배치용 ETF SQLite 카탈로그 — 미배치 시에도 시뮬레이션·6대 프리셋·간편 수익률·PDF 리포트는 100% 동작
├── .env.example                   # 로컬 실행용 호스트·포트 템플릿 (HOST=127.0.0.1, PORT=8089)
├── index.html                     # 앱 엔트리 HTML (🎚️ 인라인 SVG 파비콘 포함)
├── public/
│   └── favicon.svg                # 🎚️ 정적 SVG 파비콘
├── package.json                   # npm 스크립트 (dev, build, start, test)
├── scripts/
│   └── run_tests.sh               # TypeScript (8대 스위트 + tsc) + Python (12개 unittest) 통합 테스트 러너
├── src/
│   ├── App.tsx                    # 상단 3단계 모드 스위처(위저드·브리핑·상세분석), JSON 입출력 & PDF 리포트 상태 관리
│   ├── lib/
│   │   ├── scenarioIo.ts          # 로컬 시나리오 JSON 내보내기·불러오기 (1MB 제한, 키 화이트리스트·유한수 정화)
│   │   ├── fetchWithTimeout.ts    # 타임아웃(8초 AbortController) 내장 HTTP 클라이언트
│   │   └── ErrorBoundary.tsx      # 렌더 예외 복구 및 크래시 백업 가드
│   ├── engine/
│   │   ├── constants.ts           # 대한민국 세법·건보료(별표4 60등급)·국민연금(2026~2033 요율) 법정 상수
│   │   ├── types.ts               # 도메인 입출력 타입, 생애주기 지출·간병비 정규화 및 51개년 원장 스키마
│   │   ├── presets.ts             # 6대 연령·전략별 대표 시나리오 프리셋(법인 50% 균형·법인 100% 집중 포함)
│   │   ├── portfolioPresets.ts    # 일반(한·미 4종) & 절세(KRX 5종) 추천 ETF 프리셋 & 총액 보존 리밸런서
│   │   ├── taxAndHealth.ts        # 인별 종소세(배당 Gross-Up)·퇴직세·양도세·2026 법인세·건보료·주택보유세·급여 솔버
│   │   ├── pensionAndEtf.ts       # 출생연도별 국민연금·부동산 4대 전략·KRX ETF 과세 프로파일/수익률 계산기
│   │   ├── sincereFiling.ts       # 성실신고확인대상 소규모법인(22%) 연도별 배당 비중 판정기
│   │   ├── ledgerKernel.ts        # 단일 정규 5대 계좌 원장 커널 (runCanonicalLedger, 11,216 연차 잔차 0원)
│   │   ├── sensitivityBand.ts     # 연도별 i.i.d. 몬테카를로(100표본, σ 12%p) & 수익률 민감도(±2.0%p) 시뮬레이터
│   │   └── optimizer.ts           # 최적 배분(r*)·강건 권고·한계생활비·손익분기·4대 출구·상속세 진단 솔버
│   └── components/
│       ├── InputWizard.tsx        # ① 10+1 단계별 집중 입력 위저드
│       ├── WizardLiveChip.tsx     # 위저드 하단 실시간 판정·순자산·지속가능 생활비 요약 칩
│       ├── ActionGuideView.tsx    # ② 6단계 핵심 결과 브리핑 슬라이드 & ③ 상세 분석 + 4-Part PDF 리포트
│       ├── BriefingVisuals.tsx    # 브리핑 슬라이드용 순자산 스파크라인·누적 막대·인출 흐름도
│       ├── InfoPop.tsx            # 네이티브 Popover 기반 상세 산식·배경 설명 모달/바텀시트
│       ├── SincereFilingGuide.tsx # 법인세 성실신고확인대상(22%) 요건 및 회피 절차 안내 카드
│       ├── ControlDock.tsx        # 공유 NumericInput(드래프트 버퍼링) & FIELD_HELP_CATALOG / FieldHelpBadge
│       ├── PrecisionTuners.tsx    # 그룹별 정밀 설정 패널 & 생애 목돈 이벤트(lumpSumEvents) 에디터
│       ├── EtfPortfolioBuilder.tsx# 이원화(General / KRX Sheltered) ETF 탐색기 & 프리셋 빌더
│       ├── VerdictHeader.tsx      # 판정 히어로(VerdictHero) & 상단 4대 핵심 판정 KPI 바
│       ├── planVerdict.ts         # 안전/주의/위험 판정 분류기 및 Plan B 단일 레버 정량 해소치 역산기
│       ├── useChartWidth.ts       # ResizeObserver 기반 반응형 SVG 폭 측정 훅 (인쇄 시 780px 고정)
│       ├── Lens1AllocationTrack.tsx # 분석 01: 배분 효율 곡선(터치 2-탭 가드), 민감도 순자산 궤적 & 방어 실익 차트
│       ├── Lens2WaterfallLedger.tsx # 분석 02 & 04: 5대 계좌 적층·인출 차트 & 51개년 원장 표(첫 열 고정) + CSV
│       └── Lens3StrategyMatrix.tsx  # 분석 03: 3대 전략·법인 출구·상속세 진단·연금시기·임원 구성·A/B 비교
├── test/                          # TypeScript 엔진·시나리오·성실신고·UI 정합성 테스트 스위트 (8종 + tsc --noEmit)
├── tests/
│   └── test_server.py             # Python 무상태 백엔드 보안 위생·ETF API 단위 테스트 (12종)
├── FEATURES.md                    # 기능 명세서 (v1.0 ~ v1.2.25 전체 이력)
├── ENGINE_ANALYSIS_REPORT.md      # 금융엔진 수식 및 아키텍처 상세 분석 보고서
├── ELI5_GUIDE.md                  # 비전공자 눈높이 ELI5 가이드 문서
├── ROADMAP.md                     # 엔지니어링 로드맵 및 정합성 감사 기록
└── LICENSE                        # MIT License
```

---

## 📄 라이선스 (License)

본 프로젝트는 [MIT License](./LICENSE) 하에 배포됩니다. 시뮬레이션 결과는 세법·건보 기준에 따른 참고용 수리 계산치이며, 개별 세무·법률·투자 자문을 대체하지 않습니다.
