#pragma once

#include <array>
#include "../../general_struct.hpp"

namespace NugieApp {
  enum Side {
    LEFT   = 0,
    RIGHT  = 1,
    TOP    = 2,
    BOTTOM = 3,
    BACK   = 4,
    FRONT  = 5
  };

  class Frustum
  {
    public:
      std::array<glm::vec4, 6> getPlanes() { return this->planes; }

      void setFromViewProjection(const glm::mat4 &mvp);      

    private:
      std::array<glm::vec4, 6> planes;
  };
  
}