# Utility functions for wake word feature flattening and loading
def flatten_features(x):
    return [i.flatten() for i in x]
