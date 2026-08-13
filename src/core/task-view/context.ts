import { artifactDelivery, artifactWarnings } from '../artifact-status.js'
import type { ContextTaskReadV2, TaskStoreV2 } from '../task-store.js'
import { currentTaskIdV2, taskHistoryIncompleteForTaskV2 } from '../task-store.js'
import {
  archivedContextMetadata,
  briefTask,
  fullTask,
  groupContext,
  statusTask,
  workspaceProofView,
} from './list-status.js'
import type { ContextJsonOptions } from './list-status.js'
import { reviewTask } from './review.js'
import { projectBoundedContext } from './budget.js'
import { jsonEnvelopeV3 } from './shared.js'
import { timelineEvents } from './timeline.js'

export function contextJsonV2(
  store: TaskStoreV2,
  context: ContextTaskReadV2,
  actor: string,
  input: boolean | ContextJsonOptions,
) {
  const { task, eventLog } = context
  const options = typeof input === 'boolean' ? { brief: input } : input
  const events = eventLog.events
  const group = groupContext(store, task)
  const delivery = artifactDelivery(store.paths.workspaceRoot, task.artifacts)
  const deliveryWarnings = artifactWarnings(delivery)
  const current = currentTaskIdV2(store, actor) === task.id
  const includeRawEvents = options.review
    ? options.history === 'events' || options.history === 'both'
    : options.history !== 'timeline'
  const includeTimeline = options.review
    ? options.history === 'timeline' || options.history === 'both'
    : options.history !== 'events'
  const includeTimelineDetails = options.history !== 'timeline'
  const historyView = options.history
  if (options.sinceRevision !== undefined) {
    const deltaEvents = events.filter((event) => event.revision > options.sinceRevision!)
    return {
      ...jsonEnvelopeV3(),
      ...archivedContextMetadata(context),
      view: 'delta',
      current,
      task: statusTask(store, task, actor, context.archived),
      from_revision: options.sinceRevision,
      to_revision: task.revision,
      requires_baseline: true,
      ...(includeRawEvents ? { events: deltaEvents } : {}),
      ...(includeTimeline
        ? { timeline: timelineEvents(task, deltaEvents, includeTimelineDetails) }
        : {}),
      ...(historyView ? { history_view: historyView } : {}),
      history_incomplete: taskHistoryIncompleteForTaskV2(task, events),
      artifact_delivery: delivery,
      ...([...eventLog.warnings, ...deliveryWarnings].length > 0
        ? { warnings: [...eventLog.warnings, ...deliveryWarnings] }
        : {}),
    }
  }
  const output = {
    ...jsonEnvelopeV3(),
    ...archivedContextMetadata(context),
    view: options.status
      ? 'status'
      : options.review
        ? 'review'
        : options.brief
          ? 'brief'
          : 'full',
    current,
    task: options.status
      ? statusTask(store, task, actor, context.archived)
      : options.review
        ? reviewTask(store, task, actor, context.archived)
        : options.brief
          ? briefTask(store, task, context.archived)
          : fullTask(
              task,
              workspaceProofView(store, task, context.archived)?.live_status,
            ),
    ...(!options.status && includeRawEvents
      ? {
          recent_events:
            options.brief || options.review ? events.slice(-5) : events,
        }
      : {}),
    ...(!options.status && includeTimeline
      ? {
          timeline: timelineEvents(
            task,
            options.brief || options.review ? events.slice(-5) : events,
            includeTimelineDetails,
          ),
        }
      : {}),
    ...(!options.status && historyView ? { history_view: historyView } : {}),
    history_incomplete: taskHistoryIncompleteForTaskV2(task, events),
    artifact_delivery: delivery,
    ...([...eventLog.warnings, ...deliveryWarnings].length > 0
      ? { warnings: [...eventLog.warnings, ...deliveryWarnings] }
      : {}),
    ...(!options.status && !options.review && group ? { group } : {}),
  }
  if (options.status || options.review || options.brief)
    return projectBoundedContext(
      output,
      options.status ? 'status' : options.review ? 'review' : 'brief',
    )
  return output
}
