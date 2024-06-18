#pragma once

#include "../../general_struct.hpp"
#include <string>

namespace NugieApp {
  struct LoadedBuffer {
    std::vector<Vertex> vertices;
    std::vector<NormText> normTexts;
    std::vector<uint32_t> indices;
  };

  LoadedBuffer loadObjModel(const std::string &filePath);
}