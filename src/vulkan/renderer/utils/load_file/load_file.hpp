#pragma once

#include "../../general_struct.hpp"
#include <string>

namespace NugieApp {
  char* ReadBinaryFile(const char* pFilename, int* size);
}