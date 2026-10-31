import userEvent from '@testing-library/user-event';
import { getTagByKey } from 'librechat-data-provider';
import { render, screen, waitFor } from 'test/layout-test-utils';
import Feedback from '../Feedback';

describe('Feedback', () => {
  it('saves a thumbs-down only with its reason', async () => {
    const user = userEvent.setup();
    const handleFeedback = jest.fn();
    render(<Feedback handleFeedback={handleFeedback} />);

    await user.click(screen.getByTitle('Needs improvement'));
    await user.click(await screen.findByRole('button', { name: 'Inaccurate or incorrect answer' }));

    /** Choosing the tag opens the reason dialog instead of saving the tag alone */
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('What should have been different?');
    expect(handleFeedback).not.toHaveBeenCalled();

    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();

    await user.type(screen.getByRole('textbox'), '  cite sources ');
    expect(save).toBeEnabled();
    await user.click(save);

    expect(handleFeedback).toHaveBeenCalledWith({
      feedback: { rating: 'thumbsDown', tag: getTagByKey('inaccurate'), text: 'cite sources' },
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('saves nothing when the reason dialog closes unsaved', async () => {
    const user = userEvent.setup();
    const handleFeedback = jest.fn();
    render(<Feedback handleFeedback={handleFeedback} />);

    await user.click(screen.getByTitle('Needs improvement'));
    await user.click(await screen.findByRole('button', { name: 'Inaccurate or incorrect answer' }));
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(handleFeedback).not.toHaveBeenCalled();
    /** No delete button for feedback that was never saved */
    expect(screen.getByTitle('Needs improvement')).toBeInTheDocument();
  });

  it('saves a thumbs-up tag at once', async () => {
    const user = userEvent.setup();
    const handleFeedback = jest.fn();
    render(<Feedback handleFeedback={handleFeedback} />);

    await user.click(screen.getByTitle('Love this'));
    await user.click(await screen.findByRole('button', { name: 'Accurate and Reliable' }));

    expect(handleFeedback).toHaveBeenCalledWith({
      feedback: { rating: 'thumbsUp', tag: getTagByKey('accurate_reliable') },
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
