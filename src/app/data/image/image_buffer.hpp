#pragma once

#include "../../../vulkan/device/device.hpp"
#include "../../../vulkan/buffer/buffer.hpp"
#include "../../../vulkan/image/image.hpp"
#include "../../../vulkan/sampler/sampler.hpp"

#include <memory>

namespace NugieApp {
	class UniformImageBuffer {
		public:
			UniformImageBuffer(NugieVulkan::Device* device, uint32_t width, uint32_t height, uint32_t imageCount, VkFormat format, VkSampleCountFlagBits sample);
			~UniformImageBuffer();

			std::vector<VkDescriptorImageInfo> getImagesInfo();
			std::vector<VkDescriptorImageInfo> getSampleInfo();
      
      void prepareBarrier(NugieVulkan::CommandBuffer* commandBuffer, VkPipelineStageFlags dstStage, uint32_t frameIndex);
			void readToWriteBarrier(NugieVulkan::CommandBuffer* commandBuffer, VkPipelineStageFlags srcStage, VkPipelineStageFlags dstStage, uint32_t frameIndex);
			void writeToReadBarrier(NugieVulkan::CommandBuffer* commandBuffer, VkPipelineStageFlags srcStage, VkPipelineStageFlags dstStage, uint32_t frameIndex);

			void resize(uint32_t width, uint32_t height);

		private:
      NugieVulkan::Device* device;

      uint32_t width, height, imageCount;
      VkFormat format;
      VkSampleCountFlagBits sample;

			std::vector<NugieVulkan::Image*> images;
			std::vector<NugieVulkan::Sampler*> samplers;

      void createImages();
      void createSamplers();
      void deleteImages();
	};
	
}