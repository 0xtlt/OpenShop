import type { FlowSummary } from '../../types'

export function FlowListTable({ flows, onRun }: { flows: FlowSummary[]; onRun: (flow: FlowSummary) => void }) {
  return (
    <s-section padding="none">
      <s-table>
        <s-table-header-row>
          <s-table-header listSlot="primary">Flow</s-table-header>
          <s-table-header listSlot="secondary">Schedule</s-table-header>
          <s-table-header listSlot="inline">Type</s-table-header>
          <s-table-header></s-table-header>
        </s-table-header-row>
        <s-table-body>
          {flows.map((flow) => (
            <s-table-row key={flow.name}>
              <s-table-cell>{flow.name}</s-table-cell>
              <s-table-cell>
                {flow.crons.length === 0 ? '—' : flow.crons.map((cron, index) => (
                  <code
                    key={index}
                    style={{
                      display: 'block',
                      fontSize: '13px',
                      background: '#f1f1f1',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      marginBottom: index < flow.crons.length - 1 ? '4px' : 0,
                    }}
                  >
                    {cron.schedule}
                  </code>
                ))}
              </s-table-cell>
              <s-table-cell>
                <s-badge tone={flow.crons.length ? 'info' : 'neutral'}>
                  {flow.crons.length ? 'Scheduled' : 'Manual'}
                </s-badge>
              </s-table-cell>
              <s-table-cell>
                <s-button variant="primary" onClick={() => onRun(flow)}>
                  Run
                </s-button>
              </s-table-cell>
            </s-table-row>
          ))}
        </s-table-body>
      </s-table>
    </s-section>
  )
}
