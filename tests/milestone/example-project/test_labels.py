import unittest

from labels import label


class Labels(unittest.TestCase):
    def test_normalized_words(self):
        self.assertEqual(label("  Red\tPLUM "), "red-plum")

    def test_empty(self):
        self.assertEqual(label(" \n "), "")
