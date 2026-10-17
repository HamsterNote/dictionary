"""Standard-library offline regression entry; external socket connections fail the tests."""
import socket
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))


def forbidden(*args, **kwargs):
    raise AssertionError("Pronunciation offline tests forbid network connections")


socket.socket.connect = forbidden
socket.create_connection = forbidden
loader = unittest.defaultTestLoader
suite = unittest.TestSuite([
    loader.loadTestsFromName("test_pronunciation_contracts"),
    loader.discover(str(Path(__file__).resolve().parent), pattern="test_wiktionary_per_word_*.py"),
])
result = unittest.TextTestRunner(verbosity=1).run(suite)
sys.exit(not result.wasSuccessful())
