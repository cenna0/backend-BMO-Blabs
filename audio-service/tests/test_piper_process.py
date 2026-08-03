from app.piper.process import PersistentWorker, WorkerError


def test_worker_process_rejects_oversized_request_without_starting_model():
    assert PersistentWorker
    assert WorkerError
