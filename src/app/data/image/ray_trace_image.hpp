#pragma once

#include "../../../vulkan/device/device.hpp"
#include "../../../vulkan/buffer/buffer.hpp"
#include "../../../vulkan/image/image.hpp"
#include "../../../vulkan/texture/texture.hpp"

#include <memory>

namespace NugieApp {
	class RayTraceImage {
		public:
			RayTraceImage(NugieVulkan::Device* device, uint32_t width, uint32_t height);
			~RayTraceImage();

			std::vector<VkDescriptorImageInfo> getImagesInfo();
			std::vector<VkDescriptorImageInfo> getTexturesInfo();
      
      void prepareBarrier(NugieVulkan::CommandBuffer* commandBuffer, uint32_t frameIndex);
			void readToWriteBarrier(NugieVulkan::CommandBuffer* commandBuffer, uint32_t frameIndex);
			void writeToReadBarrier(NugieVulkan::CommandBuffer* commandBuffer, uint32_t frameIndex);

		private:
			uint32_t width, height;
      NugieVulkan::Device* device;

			std::vector<NugieVulkan::Image*> rayTraceImages;
			std::vector<NugieVulkan::Texture*> rayTraceTextures;

      void createImages();
      void createTextures();
      void deleteImages();

			VkFormat findColorFormat(const std::vector<VkFormat> &colorFormats);
	};
	
}