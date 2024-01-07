#include "image_buffer.hpp"

namespace NugieApp {
  UniformImageBuffer::UniformImageBuffer(NugieVulkan::Device* device, uint32_t width, uint32_t height, uint32_t imageCount, VkFormat format, VkSampleCountFlagBits sample)
    : device{device}, width{width}, height{height}, imageCount{imageCount}, format{format}, sample{sample}
  {
		this->createImages();
    this->createSamplers();
  }

  UniformImageBuffer::~UniformImageBuffer() {
    for (auto &&sampler : this->samplers) {
      if (sampler != nullptr) delete sampler;
    }

    this->deleteImages();
  }

	std::vector<VkDescriptorImageInfo> UniformImageBuffer::getImagesInfo() {
		std::vector<VkDescriptorImageInfo> imagesInfo{};
		
		for (int i = 0; i < this->images.size(); i++) {
			imagesInfo.emplace_back(this->images[i]->getDescriptorInfo(VK_IMAGE_LAYOUT_GENERAL));
		}

		return imagesInfo;
	}

  std::vector<VkDescriptorImageInfo> UniformImageBuffer::getSampleInfo() {
    std::vector<VkDescriptorImageInfo> imagesInfo{};
		
		for (int i = 0; i < this->samplers.size(); i++) {
			imagesInfo.emplace_back(this->samplers[i]->getDescriptorInfo(VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL));
		}

		return imagesInfo;
  }
  
  void UniformImageBuffer::createImages() {
		for (uint32_t i = 0; i < this->imageCount; i++) {
			this->images.emplace_back(new NugieVulkan::Image(
        this->device, this->width, this->height, 1, this->sample, this->format, 
          VK_IMAGE_TILING_OPTIMAL, VK_IMAGE_USAGE_STORAGE_BIT | VK_IMAGE_USAGE_SAMPLED_BIT, 
          VMA_MEMORY_USAGE_AUTO, VMA_ALLOCATION_CREATE_DEDICATED_MEMORY_BIT, VK_IMAGE_ASPECT_COLOR_BIT
      ));
		}
  }

  void UniformImageBuffer::deleteImages() {
    for (auto &&image : this->images) {
      if (image != nullptr) delete image;
    }
  }

  void UniformImageBuffer::createSamplers() {
    for (auto &&image : this->images) {
      this->samplers.push_back(new NugieVulkan::Sampler(this->device, image, VK_FILTER_NEAREST, 
        VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_BORDER, VK_FALSE, VK_BORDER_COLOR_FLOAT_OPAQUE_BLACK, VK_COMPARE_OP_NEVER, 
        VK_SAMPLER_MIPMAP_MODE_NEAREST));
    }
  }

	void UniformImageBuffer::prepareBarrier(NugieVulkan::CommandBuffer* commandBuffer, VkPipelineStageFlags dstStage, uint32_t frameIndex) {
		this->images[frameIndex]->transitionImageLayout(commandBuffer, VK_IMAGE_LAYOUT_UNDEFINED, VK_IMAGE_LAYOUT_GENERAL, 
      VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, dstStage, 0, VK_ACCESS_SHADER_WRITE_BIT);
	}

	void UniformImageBuffer::writeToReadBarrier(NugieVulkan::CommandBuffer* commandBuffer, 
    VkPipelineStageFlags srcStage, VkPipelineStageFlags dstStage, uint32_t frameIndex) 
  {
		this->images[frameIndex]->transitionImageLayout(commandBuffer, VK_IMAGE_LAYOUT_GENERAL, VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL,
      srcStage, dstStage, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);
	}

  void UniformImageBuffer::readToWriteBarrier(NugieVulkan::CommandBuffer* commandBuffer, VkPipelineStageFlags srcStage, 
    VkPipelineStageFlags dstStage, uint32_t frameIndex) 
  {
		this->images[frameIndex]->transitionImageLayout(commandBuffer, VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL, VK_IMAGE_LAYOUT_GENERAL, 
      srcStage, dstStage, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);
	}

  void UniformImageBuffer::resize(uint32_t width, uint32_t height) {
    for (size_t i = 0; i < this->images.size(); i++) {
      if (this->images[i] != nullptr) delete this->images[i];
      
      this->images[i] = new NugieVulkan::Image(
        this->device, this->width, this->height, 1, this->sample, this->format, 
          VK_IMAGE_TILING_OPTIMAL, VK_IMAGE_USAGE_STORAGE_BIT | VK_IMAGE_USAGE_SAMPLED_BIT, 
          VMA_MEMORY_USAGE_AUTO, VMA_ALLOCATION_CREATE_DEDICATED_MEMORY_BIT, VK_IMAGE_ASPECT_COLOR_BIT
      );

      this->samplers[i]->setImage(this->images[i]);
    }
  }
}