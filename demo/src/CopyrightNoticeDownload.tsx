import { buildCopyrightNotice, getSelectedDataSourceIds } from './dictionaryCopyrightNotices';

interface CopyrightNoticeDownloadProps {
  readonly activeIds: ReadonlySet<string>;
  readonly isSelectionPending: boolean;
}

const COPYRIGHT_NOTICE_FILENAME = 'hamster-note-dictionary-copyright-notices.txt';

export function CopyrightNoticeDownload({
  activeIds,
  isSelectionPending,
}: CopyrightNoticeDownloadProps) {
  const sourceCount = getSelectedDataSourceIds(activeIds).size;

  const downloadNotice = () => {
    const blob = new Blob([buildCopyrightNotice(activeIds)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.download = COPYRIGHT_NOTICE_FILENAME;
    anchor.href = url;
    try {
      document.body.append(anchor);
      anchor.click();
    } finally {
      anchor.remove();
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 0);
    }
  };

  return (
    <section className="copyright-notice" aria-labelledby="copyright-notice-title">
      <p className="copyright-notice__eyebrow">商用与再分发提醒</p>
      <h2 id="copyright-notice-title">请随产品保留适用的版权声明</h2>
      <p className="copyright-notice__description">
        <span className="cjk-keep">当前词库可用于商业场景</span>。
        <span className="cjk-keep">其来源采用开源许可或开放使用声明</span>。
        <span className="cjk-keep">各数据源的署名</span>、
        <span className="cjk-keep">许可文本保留和审核义务不同</span>。
        <span className="cjk-keep">下载按当前选择去重后的声明</span>。
        <span className="cjk-keep">发布前请逐项核对</span>，
        <span className="cjk-keep">并按实际分发场景</span>
        <span className="cjk-keep">完成独立法务审核</span>；
        <span className="cjk-keep">本说明不构成法律意见</span>。
      </p>
      <div className="copyright-notice__actions">
        <button disabled={isSelectionPending} onClick={downloadNotice} type="button">
          {isSelectionPending ? '词库加载完成后可下载' : '下载所选词库版权声明'}
        </button>
        <span>包含 {sourceCount.toLocaleString('zh-CN')} 个数据源</span>
      </div>
      <a
        href="https://github.com/HamsterNote/dictionary/blob/main/THIRD_PARTY_NOTICES.md"
        rel="noreferrer"
        target="_blank"
      >
        查看完整第三方数据与风险说明
      </a>
    </section>
  );
}
