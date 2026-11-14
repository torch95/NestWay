import React, { useId } from 'react';

/**
 * 설명형 보조 정보를 ⓘ 버튼 뒤 팝업으로 옮겨 슬라이드 본문을 간결하게 유지한다.
 * 브라우저 기본 popover(top layer) — 클릭·탭으로 열고 ESC·바깥 클릭·✕로 닫힘, 스크롤 영역에 잘리지 않음.
 * 인쇄(PDF)에서는 버튼·패널을 숨기고, PDF 리포트는 별도 분기에서 같은 내용을 펼쳐 출력한다.
 */
export const InfoPop: React.FC<{
  label: string;
  title?: string;
  /** 다열 카드(3~5열)를 담는 팝업 — 넓은 패널로 열어 좁은 열에서 글자가 세로로 줄바꿈되지 않게 한다 */
  wide?: boolean;
  children: React.ReactNode;
}> = ({ label, title, wide, children }) => {
  const id = `info-pop-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const heading = title ?? label;
  return (
    <>
      <button
        type="button"
        className="info-pop-btn"
        popoverTarget={id}
        aria-label={`${label} 자세히 보기`}
      >
        <span aria-hidden="true">ⓘ</span> {label}
      </button>
      <div id={id} popover="auto" className={wide ? 'info-pop-panel info-pop-panel--wide' : 'info-pop-panel'} role="dialog" aria-label={heading}>
        <div className="info-pop-head">
          <strong>{heading}</strong>
          <button
            type="button"
            className="info-pop-close"
            popoverTarget={id}
            popoverTargetAction="hide"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>
        <div className="info-pop-body">{children}</div>
      </div>
    </>
  );
};
