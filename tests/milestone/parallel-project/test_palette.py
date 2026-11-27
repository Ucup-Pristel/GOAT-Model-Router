import unittest


class Channels(unittest.TestCase):
    def test_red(self):
        from red import red
        self.assertEqual(red(), 255)

    def test_green(self):
        from green import green
        self.assertEqual(green(), 128)

    def test_blue(self):
        from blue import blue
        self.assertEqual(blue(), 64)

    def test_combined(self):
        from palette import rgb
        self.assertEqual(rgb(), (255, 128, 64))
