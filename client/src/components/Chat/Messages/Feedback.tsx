import React, { memo, useState, useCallback, useMemo, useEffect } from 'react';
import * as Ariakit from '@ariakit/react';
import { TFeedback, TFeedbackTag, getTagsForRating } from 'librechat-data-provider';
import {
  AlertCircle,
  PenTool,
  ImageOff,
  Ban,
  HelpCircle,
  CheckCircle,
  Lightbulb,
  Search,
} from 'lucide-react';
import {
  Button,
  OGDialog,
  Textarea,
  OGDialogContent,
  OGDialogTitle,
  TooltipAnchor,
  ThumbUpIcon,
  ThumbDownIcon,
} from '@librechat/client';
import { hoverButtonClasses } from './styles';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface FeedbackProps {
  handleFeedback: ({ feedback }: { feedback: TFeedback | undefined }) => void;
  feedback?: TFeedback;
  isLast?: boolean;
}

const ICONS = {
  AlertCircle,
  PenTool,
  ImageOff,
  Ban,
  HelpCircle,
  CheckCircle,
  Lightbulb,
  Search,
  ThumbsUp: ThumbUpIcon,
  ThumbsDown: ThumbDownIcon,
};

function FeedbackOptionButton({
  tag,
  active,
  onClick,
}: {
  tag: TFeedbackTag;
  active?: boolean;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const localize = useLocalize();
  const Icon = ICONS[tag.icon as keyof typeof ICONS] || AlertCircle;
  const label = localize(tag.label as Parameters<typeof localize>[0]);

  return (
    <Button
      variant="quiet"
      className={cn(
        'h-auto w-full justify-start gap-3 rounded-xl p-2 transition-colors duration-200',
        active && 'bg-surface-hover text-text-primary font-semibold',
      )}
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
    >
      <Icon size="1.1875rem" bold={active} aria-hidden="true" />
      <span>{label}</span>
    </Button>
  );
}

function FeedbackButtons({
  isLast,
  feedback,
  onFeedback,
  onOther,
}: {
  isLast: boolean;
  feedback?: TFeedback;
  onFeedback: (fb: TFeedback | undefined) => void;
  onOther?: () => void;
}) {
  const localize = useLocalize();
  const upStore = Ariakit.usePopoverStore({ placement: 'bottom' });
  const downStore = Ariakit.usePopoverStore({ placement: 'bottom' });

  const positiveTags = useMemo(() => getTagsForRating('thumbsUp'), []);
  const negativeTags = useMemo(() => getTagsForRating('thumbsDown'), []);

  const upActive = feedback?.rating === 'thumbsUp' ? feedback.tag?.key : undefined;
  const downActive = feedback?.rating === 'thumbsDown' ? feedback.tag?.key : undefined;

  const handleThumbsUpClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      if (feedback?.rating !== 'thumbsUp') {
        upStore.toggle();
        return;
      }
      onFeedback(undefined);
    },
    [feedback, onFeedback, upStore],
  );

  const handleUpOption = useCallback(
    (tag: TFeedbackTag) => (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      upStore.hide();
      onFeedback({ rating: 'thumbsUp', tag });
      if (tag.key === 'other') {
        onOther?.();
      }
    },
    [onFeedback, onOther, upStore],
  );

  const handleThumbsDownClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      if (feedback?.rating !== 'thumbsDown') {
        downStore.toggle();
        return;
      }

      onOther?.();
    },
    [feedback, onOther, downStore],
  );

  const handleDownOption = useCallback(
    (tag: TFeedbackTag) => (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      downStore.hide();
      /** Opens the reason dialog; the thumbs-down is saved with its reason from there. */
      onFeedback({ rating: 'thumbsDown', tag });
    },
    [onFeedback, downStore],
  );

  return (
    <>
      <Ariakit.PopoverAnchor
        store={upStore}
        render={
          <Button
            variant="ghost"
            size="icon"
            className={buttonClasses(feedback?.rating === 'thumbsUp', isLast)}
            onClick={handleThumbsUpClick}
            title={localize('com_ui_feedback_positive')}
            aria-pressed={feedback?.rating === 'thumbsUp'}
            aria-haspopup="menu"
          >
            <ThumbUpIcon size="1.1875rem" bold={feedback?.rating === 'thumbsUp'} />
          </Button>
        }
      />
      <Ariakit.Popover
        store={upStore}
        gutter={8}
        portal
        unmountOnHide
        className="popover-animate border-border-medium bg-surface-secondary rounded-theme-popover flex w-auto flex-col gap-1.5 overflow-hidden border p-1.5 shadow-lg"
      >
        <div className="flex flex-col items-stretch justify-center">
          {positiveTags.map((tag) => (
            <FeedbackOptionButton
              key={tag.key}
              tag={tag}
              active={upActive === tag.key}
              onClick={handleUpOption(tag)}
            />
          ))}
        </div>
      </Ariakit.Popover>

      <Ariakit.PopoverAnchor
        store={downStore}
        render={
          <Button
            variant="ghost"
            size="icon"
            className={buttonClasses(feedback?.rating === 'thumbsDown', isLast)}
            onClick={handleThumbsDownClick}
            title={localize('com_ui_feedback_negative')}
            aria-pressed={feedback?.rating === 'thumbsDown'}
            aria-haspopup="menu"
          >
            <ThumbDownIcon size="1.1875rem" bold={feedback?.rating === 'thumbsDown'} />
          </Button>
        }
      />
      <Ariakit.Popover
        store={downStore}
        gutter={8}
        portal
        unmountOnHide
        className="popover-animate border-border-medium bg-surface-secondary rounded-theme-popover flex w-auto flex-col gap-1.5 overflow-hidden border p-1.5 shadow-lg"
      >
        <div className="flex flex-col items-stretch justify-center">
          {negativeTags.map((tag) => (
            <FeedbackOptionButton
              key={tag.key}
              tag={tag}
              active={downActive === tag.key}
              onClick={handleDownOption(tag)}
            />
          ))}
        </div>
      </Ariakit.Popover>
    </>
  );
}

const buttonClasses = (isActive: boolean, isLast: boolean) =>
  hoverButtonClasses({ isActive, isLast });

function Feedback({ isLast = false, handleFeedback, feedback: initialFeedback }: FeedbackProps) {
  const localize = useLocalize();
  const [feedback, setFeedback] = useState<TFeedback | undefined>(initialFeedback);
  /** The feedback being written in the dialog; saved only by «ذخیره». A thumbs-down needs its
   *  reason, so choosing one of its tags opens the dialog instead of saving the tag alone. */
  const [draft, setDraft] = useState<TFeedback | null>(null);
  const openDialog = draft != null;

  useEffect(() => {
    setFeedback(initialFeedback);
  }, [initialFeedback]);

  const propagateMinimal = useCallback(
    (fb: TFeedback | undefined) => {
      setFeedback(fb);
      handleFeedback({ feedback: fb });
    },
    [handleFeedback],
  );

  const handleButtonFeedback = useCallback(
    (fb: TFeedback | undefined) => {
      if (fb?.rating === 'thumbsDown') {
        setDraft({ ...fb, text: fb.text ?? '' });
        return;
      }
      propagateMinimal(fb);
    },
    [propagateMinimal],
  );

  const handleEditOpen = useCallback(() => {
    if (feedback) {
      setDraft({ ...feedback, text: feedback.text ?? '' });
    }
  }, [feedback]);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setDraft((prev) => (prev ? { ...prev, text } : prev));
  };

  const reason = draft?.text?.trim() ?? '';
  const needsReason = draft?.rating === 'thumbsDown' && reason === '';

  const handleDialogSave = useCallback(() => {
    if (!draft || needsReason) {
      return;
    }
    propagateMinimal({ ...draft, text: reason || undefined });
    setDraft(null);
  }, [draft, needsReason, reason, propagateMinimal]);

  const handleDialogClear = useCallback(() => {
    setFeedback(undefined);
    handleFeedback({ feedback: undefined });
    setDraft(null);
  }, [handleFeedback]);

  /** Closing without saving drops the draft and keeps whatever was saved before. */
  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setDraft(null);
    }
  }, []);

  const renderSingleFeedbackButton = () => {
    if (!feedback) return null;
    const isThumbsUp = feedback.rating === 'thumbsUp';
    const Icon = isThumbsUp ? ThumbUpIcon : ThumbDownIcon;
    const label = isThumbsUp
      ? localize('com_ui_feedback_positive')
      : localize('com_ui_feedback_negative');
    return (
      <TooltipAnchor
        description={label}
        render={
          <Button
            variant="ghost"
            size="icon"
            className={buttonClasses(true, isLast)}
            onClick={() => {
              if (isThumbsUp) {
                handleButtonFeedback(undefined);
              } else {
                handleEditOpen();
              }
            }}
            aria-label={label}
            aria-pressed="true"
          >
            <Icon size="1.1875rem" bold />
          </Button>
        }
      />
    );
  };

  const tagLabel = draft?.tag
    ? localize(draft.tag.label as Parameters<typeof localize>[0])
    : undefined;

  return (
    <>
      {feedback ? (
        renderSingleFeedbackButton()
      ) : (
        <FeedbackButtons
          isLast={isLast}
          feedback={feedback}
          onFeedback={handleButtonFeedback}
          onOther={handleEditOpen}
        />
      )}
      <OGDialog open={openDialog} onOpenChange={handleOpenChange}>
        <OGDialogContent className="w-11/12 max-w-lg">
          <OGDialogTitle className="text-lg leading-6 font-semibold">
            {draft?.rating === 'thumbsDown'
              ? localize('com_ui_feedback_reason_title')
              : localize('com_ui_feedback_more_information')}
          </OGDialogTitle>
          {tagLabel && <p className="text-text-secondary text-sm">{tagLabel}</p>}
          <Textarea
            className="h-auto w-full rounded-xl p-2"
            value={draft?.text || ''}
            onChange={handleTextChange}
            rows={4}
            placeholder={localize('com_ui_feedback_reason_placeholder')}
            aria-describedby="feedback-reason-hint"
            aria-required={draft?.rating === 'thumbsDown'}
            maxLength={500}
          />
          <p id="feedback-reason-hint" className="text-text-secondary text-xs">
            {localize('com_ui_feedback_reason_hint')}
          </p>
          <div className="mt-4 flex items-end justify-end gap-2">
            {feedback && (
              <Button variant="destructive" onClick={handleDialogClear}>
                {localize('com_ui_delete')}
              </Button>
            )}
            <Button variant="submit" onClick={handleDialogSave} disabled={needsReason}>
              {localize('com_ui_save')}
            </Button>
          </div>
        </OGDialogContent>
      </OGDialog>
    </>
  );
}

/** Memoized: a send re-renders every row's toolbar, and nothing here depends on it. */
export default memo(Feedback);
